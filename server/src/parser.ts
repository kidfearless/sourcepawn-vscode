import { FileCompletions, FunctionCompletion, DefineCompletion, FunctionParam, MethodCompletion, ClassCompletion, PropertyCompletion, VariableCompletion } from './completions';
import * as fs from 'fs';
import { completionRepository } from './server';
import { count } from 'console';

export function parse_file(file: string, fileCompletions: FileCompletions)
{
	fs.readFile(file, "utf-8", (err, data) =>
	{
		parse_blob(data, fileCompletions);
		if (err)
		{
			console.error(err);
		}
	});
}

export function parse_blob(data: string, fileCompletions: FileCompletions)
{
	if (typeof data === 'undefined')
	{
		return; // Asked to parse empty file
	}

	let lines = data.split("\n");
	let parser = new Parser(lines, fileCompletions);

	parser.parse();
}

interface iDocumentation
{
	label: string;
	documentation: string;
}

enum State
{
	None,
	MultilineComment,
	DocComment,
	Enum,
	Methodmap,
	Property
}

class Parser
{
	lines: string[];
	fileCompletions: FileCompletions;
	state: State[];
	scratch: string[];
	state_data: any;

	constructor(lines: string[], filecompletion: FileCompletions)
	{
		this.lines = lines;
		this.fileCompletions = filecompletion;
		this.state = [State.None];
		this.scratch = [];
	}

	parse(): undefined | any
	{
		let line = this.lines.shift();
		if (typeof line === 'undefined')
		{
			return;
		}

		let match = line.match(/\s*#define\s+([A-Za-z0-9_]+)/);
		if (match)
		{
			this.fileCompletions.add(match[1], new DefineCompletion(match[1]));
			return this.parse();
		}

		match = line.match(/^\s*#include\s+<([A-Za-z0-9\-_\/]+)>\s*$/);
		if (match)
		{
			this.fileCompletions.resolve_import(match[1]);
			return this.parse();
		}

		match = line.match(/^\s*#include\s+"([A-Za-z0-9\-_\/.]+)"\s*$/);
		if (match)
		{
			this.fileCompletions.resolve_import(match[1], true);
			return this.parse();
		}

		match = line.match(/^\s*\/\*/);
		if (match)
		{
			this.state.push(State.MultilineComment);
			this.scratch = [];

			this.consume_multiline_comment(line);
			return this.parse();
		}

		match = line.match(/^\s*\/\//);
		if (match)
		{
			if (this.lines[0] && this.lines[0].match(/^\s*\/\//))
			{
				this.state.push(State.MultilineComment);
				this.scratch = [];

				this.consume_multiline_comment(line, true);
				return this.parse();
			}
		}

		match = line.match(/^\s*methodmap\s+([a-zA-Z][a-zA-Z0-9_]*)(?:\s+<\s+([a-zA-Z][a-zA-Z0-9_]*))?/);
		if (match)
		{
			this.state.push(State.Methodmap);
			this.state_data = {
				name: match[1]
			};

			let methodmap = new ClassCompletion(match[1]);
			this.fileCompletions.add(methodmap.name, methodmap);

			return this.parse();
		}

		if (this.state.includes(State.Methodmap))
		{
			match = line.match(/^\s*property\s+([a-zA-Z][a-zA-Z0-9_]*)\s+([a-zA-Z][a-zA-Z0-9_]*)/);
			if (match)
			{
				this.state.push(State.Property);


				let property = new PropertyCompletion(match[1]);
				this.fileCompletions.add(property.name, property);

				// no body for this property
				if(!line.includes(';'))
				{
					this.consumeBody(line);
				}

				this.state.pop();

				return this.parse();
			}
		}

		match = line.match(/}/);
		if (match)
		{
			this.state.pop();

			return this.parse();
		}

		match = line.match(/\s*(?:(?:static|native|stock|public)+\s*)+\s+(?:[a-zA-Z\-_0-9]:)?([^\s]+)\s*\(\s*([A-Za-z_].*)/);
		if (match)
		{
			this.fileCompletions.add(match[1], new FunctionCompletion(match[1], match[2], "", []));
			return this.parse();
		}

		match = line.match(/^\s*(?:static |stock |const |public |native|forward )*\s*(?!return |else |case |delete |enum )(\w+)\s+(\w+)\(.*\)/);
		if (match)
		{
			let name_match = match[2].match(/^([A-Za-z_][A-Za-z0-9_]*)/);
			if (name_match)
			{

				if (this.state[this.state.length - 1] === State.Methodmap)
				{
					this.fileCompletions.add(name_match[1], new MethodCompletion(this.state_data.name, name_match[1], match[2], "", []));
				}
				else
				{
					this.fileCompletions.add(name_match[1], new FunctionCompletion(name_match[1], match[2], "", []));
				}
			}
			return this.parse();
		}

		// must be after functions, enums, and enum structs
		match = line.match(/^\s*(?:static |stock |const |public )*\s*(?!return |else |case |delete |enum )(\w+)\s+(\w+)[^(\n]*$/);
		if (match)
		{
			let varcompletion = new VariableCompletion(match[1], match[2]);
			this.fileCompletions.add(varcompletion.name, varcompletion);
			return this.parse();
		}


		this.parse();
	}

	consume_multiline_comment(current_line: string | undefined, use_line_comment: boolean = false)
	{
		if (!current_line)
		{
			return; // EOF
		}
		// Check if the comment ends here
		let match: any = (use_line_comment) ? !/^\s*\/\//.test(current_line) : /\*\//.test(current_line);
		if (match)
		{
			if (this.state[this.state.length - 1] === State.DocComment)
			{
				this.state.pop();
				this.state.pop();

				if (use_line_comment)
				{
					return this.read_function(current_line);
				}
				else
				{
					return this.read_function(this.lines.shift());
				}
			}

			this.state.pop();
			return this.parse();
		}
		else
		{
			if (!use_line_comment)
			{
				match = current_line.match(/^\s*\*\s*@(?:param|return)\s*([A-Za-z_\.][A-Za-z0-9_\.]*)\s*(.*)/);
			}
			else
			{
				match = current_line.match(/^\s*\/\/\s*@(?:param|return)\s*([A-Za-z_\.][A-Za-z0-9_\.]*)\s*(.*)/);
			}

			if (match)
			{
				if (this.state[this.state.length - 1] !== State.DocComment)
				{
					this.state.push(State.DocComment);
				}
			}

			this.scratch.push(current_line);

			this.consume_multiline_comment(this.lines.shift(), use_line_comment);
		}
	}

	read_function(line: string | undefined)
	{
		if (!line)
		{
			return;
		}

		// TODO: Support multiline function definitions
		if (line.includes(":"))
		{
			this.read_old_style_function(line);
		}
		else
		{
			this.read_new_style_function(line);
		}

		this.state.pop();
		this.parse();
	}

	read_old_style_function(line: string)
	{
		let match = line.match(/\s*(?:(?:static|native|stock|public)+\s*)+\s+(?:[a-zA-Z\-_0-9]:)?([^\s]+)\s*\(\s*([A-Za-z_].*)/);
		if (match)
		{
			let { description, params } = this.parse_doc_comment();
			this.fileCompletions.add(match[1], new FunctionCompletion(match[1], match[2], description, params));
		}
	}

	read_new_style_function(line: string)
	{
		let match = line.match(/\s*(?:(?:static|native|stock|public)+\s*)+\s+([^\s]+)\s*([A-Za-z_].*)/);
		if (match)
		{
			let { description, params } = this.parse_doc_comment();

			let name_match = match[2].match(/^([A-Za-z_][A-Za-z0-9_]*)/);
			if (name_match)
			{

				if (this.state[this.state.length - 1] === State.Methodmap)
				{
					this.fileCompletions.add(name_match[1], new MethodCompletion(this.state_data.name, name_match[1], match[2], description, params));
				}
				else
				{
					this.fileCompletions.add(name_match[1], new FunctionCompletion(name_match[1], match[2], description, params));
				}
			}
		}
	}

	parse_doc_comment(): { description: string, params: FunctionParam[] }
	{
		let description = (() =>
		{
			let lines = [];
			for (let line of this.scratch)
			{
				if (!(/^\s*\*\s+([^@].*)/.test(line) || /^\s*\/\/\s+([^@].*)/.test(line)))
				{
					break;
				}

				lines.push(line.replace(/^\s*\*\s+/, "").replace(/^\s*\/\/\s+/, ""));
			}

			return lines.join(' ');
		})();

		const paramRegex = /@param\s+([A-Za-z0-9_\.]+)\s+(.*)/;

		let params = [];
		let current_param: iDocumentation | undefined = undefined;
		for (let line of this.scratch)
		{
			let match = line.match(paramRegex);
			if (match)
			{
				if (current_param)
				{
					params.push(current_param);
				}

				current_param = { label: match[1], documentation: match[2] };
			}
			else
			{
				if (!/@(?:return|error)/.test(line))
				{
					let match = line.match(/\s*(?:\*|\/\/)\s*(.*)/);
					if (match)
					{
						if (current_param)
						{
							current_param.documentation += (" " + match[1]);
						}
					}
				}
				else
				{
					if (current_param)
					{
						params.push(current_param);

						current_param = undefined;
					}
				}
			}
		}

		return { description, params };
	}

	consumeBody(line: string)
	{
		// check for same line bracing style
		let counter = 0;
		counter = line.lastIndexOf('{') >= 0 ? 1 : 0;
		// start the loop if we've already got our first brace
		if (counter === 1)
		{
			while (counter != 0)
			{
				let body = this.lines.shift();
				if (!body)
				{
					return;
				}

				for(let c of body)
				{
					if(c === '{')
					{
						counter++;
					}
					if(c === '}')
					{
						counter--;
					}
					if (counter === 0)
					{
						break;
					}
				}
			}
		}
		else
		{
			// keep looping till we find the first brace
			let body = this.lines.shift();
			if(!body)
			{
				return;
			}
			let match = body.match(/\{/);
			while (!match)
			{
				body = this.lines.shift();
				if (!body)
				{
					return;
				}
				match = body.match(/\{/);
			}

			// increment the the number of opening braces found
			counter += match.length;
			// check for closing braces before we continue
			match = body.match(/\}/);
			if (match)
			{
				counter -= match.length;
				if (counter === 0)
				{
					return;
				}
			}
			// if this wasn't a single line body then we begin our loop
			if (counter > 0)
			{
				while (counter !== 0)
				{
					body = this.lines.shift();
					if (!body)
					{
						return;
					}

					for(let c of body)
					{
						if(c === '{')
						{
							counter++;
						}
						if(c === '}')
						{
							counter--;
						}
						if (counter === 0)
						{
							break;
						}
					}
				}
			}
		}	
	}
}