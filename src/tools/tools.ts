import type {Tool} from 'ollama';
import {listFiles} from './core/list_files.ts';
import {readWorkspaceFile} from './core/read_files.ts';

type ToolEntry = {
    type: "function";
    name: string;
    description: string;
    parameters: NonNullable<Tool["function"]["parameters"]>;
    func: (args: any) => Promise<unknown>;
};

const tools: ToolEntry[] = [
    {
        type : "function" as const ,
        name :"ListFiles",
        description : "List files in a workspace directory and its subdirectories (paths relative to the workspace root). Only directories inside the workspace are allowed; returns at most 200 files with a total count.",
        parameters : {
            type : "object" as const ,
            properties : {
                dir : {
                    type : "string" as const ,
                    description : "Directory inside the workspace to list, e.g. \".\" for the root or \"src\".",
                },
            },
            required : ["dir"],
        },
        func : async (args: { dir: string }) => {
            return await listFiles(args.dir);
        },
    },
    {
        type : "function" as const ,
        name :"ReadFile",
        description : "Read the text contents of a single file inside the workspace (max 100 KB). Use ListFiles first to find the exact path.",
        parameters : {
            type : "object" as const ,
            properties : {
                path : {
                    type : "string" as const ,
                    description : "File path relative to the workspace root, e.g. \"src/index.ts\".",
                },
            },
            required : ["path"],
        },
        func : async (args: { path: string }) => {
            return await readWorkspaceFile(args);
        },
    }
]

export async function executeTool(toolName: string, args: any): Promise<any> {
    const tool = tools.find(t => t.name === toolName);
    if (!tool) {
        throw new Error(`Tool ${toolName} not found.`);
    }
    return await tool.func(args);
}

export async function getToolNames(): Promise<string[]> {
    return tools.map(t => t.name);
}

// Tool schemas in the shape Ollama's chat API expects (without the func implementation).
// Pass names to expose only a subset of tools to the model.
export function getToolDefinitions(names?: string[]): Tool[] {
    return tools
        .filter(t => !names || names.includes(t.name))
        .map(({ type, name, description, parameters }) => ({
        type,
        function: { name, description, parameters },
    }));
}


