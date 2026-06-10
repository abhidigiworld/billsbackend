const Employee = require('../models/Employee');
const Attendance = require('../models/Attendance');
const aiService = require('../services/aiService');
const config = require('../config/config');

exports.aiChat = async (req, res, next) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'Messages are required and must be an array.' });
  }

  try {
    const lastUserMessage = messages[messages.length - 1]?.content || '';
    const msgLower = lastUserMessage.toLowerCase();
    
    const isAttendanceCommand = msgLower.includes('mark') && 
                                (msgLower.includes('attendance') || 
                                 msgLower.includes('present') || 
                                 msgLower.includes('absent') || 
                                 msgLower.includes('leave') || 
                                 msgLower.includes('holiday'));

    let isAddEmployeeTurn = false;
    const isEmployeeAddCommand = (msgLower.includes('add') || msgLower.includes('register') || msgLower.includes('create')) && 
                                 (msgLower.includes('employee') || 
                                  msgLower.includes('member') || 
                                  msgLower.includes('staff') || 
                                  msgLower.includes('worker') ||
                                  msgLower.includes('profile') ||
                                  msgLower.includes('salary') ||
                                  msgLower.includes('designation') ||
                                  msgLower.includes('location'));
                                  
    if (isEmployeeAddCommand) {
      isAddEmployeeTurn = true;
    } else {
      const assistantMessages = messages.filter(m => m.role === 'assistant');
      if (assistantMessages.length > 0) {
        const lastAssistantMsg = assistantMessages[assistantMessages.length - 1].content;
        if (lastAssistantMsg.includes('Please provide the missing details') || 
            lastAssistantMsg.includes('Please provide the remaining recommended field') ||
            lastAssistantMsg.includes('I still need the following details') ||
            lastAssistantMsg.includes('I detected you want to add a new employee')) {
          isAddEmployeeTurn = true;
        }
      }
    }

    const isPlaceholderKey = !config.GROQ_API_KEY;

    // Fallback Employee Add Parser for Local Testing/No API Key
    if (isPlaceholderKey && isAddEmployeeTurn) {
      console.log('[AI Chat] Fallback Mode: Parsing local employee add command:', lastUserMessage);
      const reply = await aiService.handleLocalAddEmployeeCommand(messages);
      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: reply
            }
          }
        ]
      });
    }

    // Fallback Intent Parser for Local Testing/No API Key
    if (isPlaceholderKey && isAttendanceCommand) {
      console.log('[AI Chat] Fallback Mode: Parsing local attendance command:', lastUserMessage);
      const reply = await aiService.handleLocalAttendanceCommand(lastUserMessage);
      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: reply
            }
          }
        ]
      });
    }

    if (isPlaceholderKey) {
      console.warn('GROQ_API_KEY is not defined or is placeholder. Returning a stubbed response.');
      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Hello! I am ABHI digi AI. Currently, the Groq API key is not configured in the backend, but I am ready to help you manage invoices, track attendance, and draft emails once it is set up!'
            }
          }
        ]
      });
    }

    // Cap message history to last 6 messages
    const capMessages = messages.slice(-6);

    // Mask sensitive info
    const sanitizedMessages = capMessages.map(msg => ({
      role: msg.role,
      content: aiService.maskSensitiveData(msg.content)
    }));

    // Base system prompt
    let systemPromptText = 'You are ABHI digi AI, a secure corporate billing and payroll assistant for Sakshi Enterprises. You help users draft emails (e.g. invoice sending, payment reminders, salary slip notices), explain billing and Indian taxation concepts (CGST, SGST, IGST, HSN codes), and guide them on how to navigate this invoice and payroll system. For security, never ask for or process passwords, bank credentials, or private personal identifiers. Be concise, polite, and professional. IMPORTANT: For attendance marking, you have access to tools to update attendance logs (blanket mark all active employees, or mark specific employees). Use these tools whenever the user requests to mark attendance. You also have the `addEmployee` tool to register new employees. If a user asks to add an employee, you must interactively gather the required/recommended details: Name, Gross Salary, Date of Joining, Designation, and Location. Do not prompt for Email or Default Shift as they are strictly optional. If any of these recommended/required fields are missing, list them and ask the user to provide them before you invoke the `addEmployee` tool. However, if the user instructs you to save/proceed anyway with the details they have provided, you may execute the tool with what is available. For all other database entities (invoices, employee salary slips, and payroll profiles), you are strictly read-only and cannot write, modify, or delete them. If a user asks you to modify those, instruct them to use the dashboard controls manually.';

    // Inject database context
    if (aiService.isDatabaseQuery(capMessages)) {
      console.log('[AI Chat] Analytics query detected. Fetching secure MongoDB aggregate metadata...');
      const dbSummary = await aiService.getDatabaseSummaryMetadata();
      systemPromptText += `\n\nReal-time database context for answering user questions:\n${dbSummary}`;
    }

    // Inject specific document context
    const userPrompt = sanitizedMessages[sanitizedMessages.length - 1]?.content || '';
    const specificContext = await aiService.fetchContextFromDb(userPrompt);
    if (specificContext) {
      console.log('[AI Chat] Specific database document context fetched. Injecting...');
      systemPromptText += `\n\nSpecific document details fetched from database to help you answer the user's request:\n${specificContext}`;
    }

    // Inject Navigation Flow Guide
    const isNavigationQuery = sanitizedMessages.some(msg => {
      const txt = msg.content.toLowerCase();
      return txt.includes('how') || txt.includes('step') || txt.includes('guide') || txt.includes('navigate') || txt.includes('flow') || txt.includes('workflow') || txt.includes('instruction') || txt.includes('help');
    });
    if (isNavigationQuery) {
      console.log('[AI Chat] Navigation instruction query detected. Injecting website flow guide...');
      systemPromptText += `\n\n${aiService.WEBSITE_FLOW_GUIDE}`;
    }

    const systemPrompt = {
      role: 'system',
      content: systemPromptText
    };

    const tools = [
      {
        type: 'function',
        function: {
          name: 'blanketMarkAttendance',
          description: 'Mark attendance for all active employees at once for a specific day.',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: 'The date in YYYY-MM-DD format.' },
              status: { type: 'string', enum: ['Present', 'Absent', 'Leave', 'Holiday'], description: 'Attendance status' },
              checkIn: { type: 'string', description: 'Check-in time (HH:MM format, 24-hour clock, defaults to 09:30)' },
              checkOut: { type: 'string', description: 'Check-out time (HH:MM format, 24-hour clock, defaults to 17:30)' }
            },
            required: ['date', 'status']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'markMultipleEmployeesAttendance',
          description: 'Mark attendance for a specific list of employees by their name on a specific day.',
          parameters: {
            type: 'object',
            properties: {
              employeeNames: { 
                type: 'array', 
                items: { type: 'string' },
                description: 'Array of employee names to mark attendance for.' 
              },
              date: { type: 'string', description: 'The date in YYYY-MM-DD format.' },
              status: { type: 'string', enum: ['Present', 'Absent', 'Leave', 'Holiday'], description: 'Attendance status' },
              checkIn: { type: 'string', description: 'Check-in time (HH:MM format, 24-hour clock, defaults to 09:30)' },
              checkOut: { type: 'string', description: 'Check-out time (HH:MM format, 24-hour clock, defaults to 17:30)' }
            },
            required: ['employeeNames', 'date', 'status']
          }
        }
      },
      {
        type: 'function',
        function: {
          name: 'addEmployee',
          description: 'Add a new employee to the database.',
          parameters: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Full name of the employee.' },
              grossSalary: { type: 'number', description: 'Gross monthly salary of the employee in INR.' },
              dateOfJoining: { type: 'string', description: 'Date of joining in YYYY-MM-DD format.' },
              designation: { type: 'string', description: 'Designation / job title (e.g. Developer, Clerk).' },
              location: { type: 'string', description: 'Working location (e.g. Delhi, Noida).' },
              email: { type: 'string', description: 'Email address of the employee (Optional).' },
              defaultShift: { type: 'string', description: 'Default shift timing (e.g. Day (09:30 - 17:30) or Night (20:00 - 04:00)). Default is Day (09:30 - 17:30).' }
            },
            required: ['name', 'grossSalary', 'dateOfJoining']
          }
        }
      }
    ];

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        messages: [systemPrompt, ...sanitizedMessages],
        tools: tools,
        tool_choice: 'auto',
        temperature: 0.3,
        max_tokens: 800
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Groq API error:', errText);
      return res.status(502).json({ error: 'Failed to communicate with AI service. Please try again.' });
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;

    // Parse and execute text-based tool calls in content field (e.g. from Llama 3.1)
    let content = message?.content || '';
    const textToolRegex = /<function>(\w+)>?(.*?)<\/function>/gs;
    let textToolMatch;
    let textResults = [];
    let executedAnyTextTool = false;

    textToolRegex.lastIndex = 0;
    while (message && (textToolMatch = textToolRegex.exec(content)) !== null) {
      const funcName = textToolMatch[1];
      const argsStr = textToolMatch[2].trim();
      console.log(`[AI Chat] Intercepted text-based tool call in content: ${funcName} with args: ${argsStr}`);
      
      let args = {};
      try {
        if (argsStr) {
          args = JSON.parse(argsStr);
        }
      } catch (e) {
        console.error('[AI Chat] Failed to parse text-based tool call JSON arguments:', e);
      }

      let resultMsg = "";
      try {
        if (funcName === 'addEmployee') {
          executedAnyTextTool = true;
          const employeeData = {
            name: args.name,
            grossSalary: Number(args.grossSalary),
            dateOfJoining: args.dateOfJoining ? new Date(args.dateOfJoining) : new Date(),
            designation: args.designation || '',
            location: args.location || '',
            defaultShift: args.defaultShift || 'Day (09:30 - 17:30)'
          };
          if (args.email && args.email.trim() !== '') {
            employeeData.email = args.email;
          }
          const employee = new Employee(employeeData);
          const savedEmployee = await employee.save();
          resultMsg = `Successfully added new employee **${savedEmployee.name}**! 🎉\n` +
                      `- Designation: ${savedEmployee.designation || 'N/A'}\n` +
                      `- Location: ${savedEmployee.location || 'N/A'}\n` +
                      `- Gross Salary: ₹${savedEmployee.grossSalary}\n` +
                      `- Date of Joining: ${args.dateOfJoining || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}`;
        } else if (funcName === 'blanketMarkAttendance') {
          executedAnyTextTool = true;
          const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
          let checkInDate = null;
          let checkOutDate = null;
          if (args.status === 'Present') {
            const checkIn = args.checkIn || '09:30';
            const checkOut = args.checkOut || '17:30';
            checkInDate = new Date(`${args.date}T${checkIn}:00+05:30`);
            checkOutDate = new Date(`${args.date}T${checkOut}:00+05:30`);
          }
          const operations = employees.map(emp => ({
            updateOne: {
              filter: { employeeId: emp._id, date: args.date },
              update: {
                $set: {
                  status: args.status,
                  checkIn: checkInDate,
                  checkOut: checkOutDate,
                  nightCheckIn: null,
                  nightCheckOut: null,
                  overtimeHours: 0,
                  isNightShift: false,
                  nightShiftHours: 0
                }
              },
              upsert: true
            }
          }));
          await Attendance.bulkWrite(operations);
          resultMsg = `Successfully marked all active employees (${employees.length}) as ${args.status} on ${args.date}${args.status === 'Present' ? ` from ${args.checkIn || '09:30'} to ${args.checkOut || '17:30'}` : ''}.`;
        } else if (funcName === 'markMultipleEmployeesAttendance') {
          executedAnyTextTool = true;
          const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
          const names = args.employeeNames.map(n => n.toLowerCase());
          const targetEmployees = employees.filter(emp => names.some(n => emp.name.toLowerCase().includes(n) || n.includes(emp.name.toLowerCase())));

          if (targetEmployees.length === 0) {
            resultMsg = `Could not find any active employees matching the names: ${args.employeeNames.join(', ')}.`;
          } else {
            let checkInDate = null;
            let checkOutDate = null;
            if (args.status === 'Present') {
              const checkIn = args.checkIn || '09:30';
              const checkOut = args.checkOut || '17:30';
              checkInDate = new Date(`${args.date}T${checkIn}:00+05:30`);
              checkOutDate = new Date(`${args.date}T${checkOut}:00+05:30`);
            }
            const operations = targetEmployees.map(emp => ({
              updateOne: {
                filter: { employeeId: emp._id, date: args.date },
                update: {
                  $set: {
                    status: args.status,
                    checkIn: checkInDate,
                    checkOut: checkOutDate,
                    nightCheckIn: null,
                    nightCheckOut: null,
                    overtimeHours: 0,
                    isNightShift: false,
                    nightShiftHours: 0
                  }
                },
                upsert: true
              }
            }));
            await Attendance.bulkWrite(operations);
            const matchedNames = targetEmployees.map(e => e.name).join(', ');
            resultMsg = `Successfully marked attendance for ${targetEmployees.length} employees (${matchedNames}) as ${args.status} on ${args.date}${args.status === 'Present' ? ` from ${args.checkIn || '09:30'} to ${args.checkOut || '17:30'}` : ''}.`;
          }
        }
      } catch (err) {
        console.error(`Error executing text tool ${funcName}:`, err);
        resultMsg = `Failed to execute tool ${funcName}: ${err.message}`;
      }

      if (resultMsg) {
        textResults.push(resultMsg);
      }
    }

    content = content.replace(/<function>.*?<\/function>/gs, '').trim();

    if (executedAnyTextTool) {
      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: textResults.join('\n') + (content ? `\n\n${content}` : '')
            }
          }
        ]
      });
    }

    if (message) {
      message.content = content;
    }

    if (message && message.tool_calls && message.tool_calls.length > 0) {
      console.log('[AI Chat] LLM triggered tool calls:', message.tool_calls.map(tc => tc.function.name));
      const results = [];
      for (const call of message.tool_calls) {
        const funcName = call.function.name;
        const args = JSON.parse(call.function.arguments);
        let resultMsg = "";

        try {
          if (funcName === 'blanketMarkAttendance') {
            const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
            let checkInDate = null;
            let checkOutDate = null;
            if (args.status === 'Present') {
              const checkIn = args.checkIn || '09:30';
              const checkOut = args.checkOut || '17:30';
              checkInDate = new Date(`${args.date}T${checkIn}:00+05:30`);
              checkOutDate = new Date(`${args.date}T${checkOut}:00+05:30`);
            }
            const operations = employees.map(emp => ({
              updateOne: {
                filter: { employeeId: emp._id, date: args.date },
                update: {
                  $set: {
                    status: args.status,
                    checkIn: checkInDate,
                    checkOut: checkOutDate,
                    nightCheckIn: null,
                    nightCheckOut: null,
                    overtimeHours: 0,
                    isNightShift: false,
                    nightShiftHours: 0
                  }
                },
                upsert: true
              }
            }));
            await Attendance.bulkWrite(operations);
            resultMsg = `Successfully marked all active employees (${employees.length}) as ${args.status} on ${args.date}${args.status === 'Present' ? ` from ${args.checkIn || '09:30'} to ${args.checkOut || '17:30'}` : ''}.`;
          } else if (funcName === 'markMultipleEmployeesAttendance') {
            const employees = await Employee.find({ status: { $ne: 'Discontinued' } });
            const names = args.employeeNames.map(n => n.toLowerCase());
            const targetEmployees = employees.filter(emp => names.some(n => emp.name.toLowerCase().includes(n) || n.includes(emp.name.toLowerCase())));

            if (targetEmployees.length === 0) {
              resultMsg = `Could not find any active employees matching the names: ${args.employeeNames.join(', ')}.`;
            } else {
              let checkInDate = null;
              let checkOutDate = null;
              if (args.status === 'Present') {
                const checkIn = args.checkIn || '09:30';
                const checkOut = args.checkOut || '17:30';
                checkInDate = new Date(`${args.date}T${checkIn}:00+05:30`);
                checkOutDate = new Date(`${args.date}T${checkOut}:00+05:30`);
              }
              const operations = targetEmployees.map(emp => ({
                updateOne: {
                  filter: { employeeId: emp._id, date: args.date },
                  update: {
                    $set: {
                      status: args.status,
                      checkIn: checkInDate,
                      checkOut: checkOutDate,
                      nightCheckIn: null,
                      nightCheckOut: null,
                      overtimeHours: 0,
                      isNightShift: false,
                      nightShiftHours: 0
                    }
                  },
                  upsert: true
                }
              }));
              await Attendance.bulkWrite(operations);
              const matchedNames = targetEmployees.map(e => e.name).join(', ');
              resultMsg = `Successfully marked attendance for ${targetEmployees.length} employees (${matchedNames}) as ${args.status} on ${args.date}${args.status === 'Present' ? ` from ${args.checkIn || '09:30'} to ${args.checkOut || '17:30'}` : ''}.`;
            }
          } else if (funcName === 'addEmployee') {
            const employeeData = {
              name: args.name,
              grossSalary: Number(args.grossSalary),
              dateOfJoining: new Date(args.dateOfJoining),
              designation: args.designation || '',
              location: args.location || '',
              defaultShift: args.defaultShift || 'Day (09:30 - 17:30)'
            };
            if (args.email && args.email.trim() !== '') {
              employeeData.email = args.email;
            }
            const employee = new Employee(employeeData);
            const savedEmployee = await employee.save();
            resultMsg = `Successfully added new employee ${savedEmployee.name} with Designation: ${savedEmployee.designation || 'N/A'}, Location: ${savedEmployee.location || 'N/A'}, Salary: ₹${savedEmployee.grossSalary}, and Date of Joining: ${args.dateOfJoining}.`;
          }
        } catch (err) {
          console.error(`Error executing tool ${funcName}:`, err);
          resultMsg = `Failed to execute tool ${funcName}: ${err.message}`;
        }
        results.push(resultMsg);
      }

      return res.json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: results.join('\n')
            }
          }
        ]
      });
    }

    res.json(data);
  } catch (error) {
    next(error);
  }
};
