import
{
	IPCMessageReader, IPCMessageWriter, IConnection, createConnection,
	TextDocuments, CompletionItemKind, CompletionItem, TextDocumentSyncKind, DidSaveTextDocumentParams, DidChangeConfigurationParams
} from "vscode-languageserver";

import * as glob from 'glob';
import * as path from 'path';

import { Completion, CompletionRepository } from './completions';
import { parse_file } from './parser';
import URI from 'vscode-uri';

let connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
let documents = new TextDocuments();
documents.listen(connection);

export let completionRepository = new CompletionRepository(documents);

let workspaceRoot: string;
let sm_home:string;

connection.onInitialize((params) =>
{
	workspaceRoot = params.rootPath?? "";

	return {
		capabilities: {
			textDocumentSync: documents.syncKind,
			completionProvider: {
				resolveProvider: false
			},
			signatureHelpProvider: {
				triggerCharacters: ["("]
			}
		}
	};
});

connection.onDidChangeConfiguration((change: DidChangeConfigurationParams) =>
{
	sm_home = change.settings.sourcepawnLanguageServer.sourcemod_home;
	if (sm_home)
	{
		completionRepository.parse_sm_api(sm_home);
	}
});

connection.onDidSaveTextDocument((params: DidSaveTextDocumentParams) =>
{
	if (sm_home)
	{
		completionRepository.parse_sm_api(sm_home);
	}
});

connection.onCompletion((textDocumentPosition) =>
{
	return completionRepository.get_completions(textDocumentPosition);
});

connection.onSignatureHelp((textDocumentPosition) =>
{
	return completionRepository.get_signature(textDocumentPosition);
});

connection.listen();