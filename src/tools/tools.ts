import {listFiles} from './core/list_files.ts';

const tools = [
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
export function getToolDefinitions() {
    return tools.map(({ type, name, description, parameters }) => ({
        type,
        function: { name, description, parameters },
    }));
}


