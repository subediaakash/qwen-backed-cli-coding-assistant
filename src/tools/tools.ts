import {listFiles} from './core/list_files.ts';

const tools = [
    {
        type : "function" as const ,
        name :"ListFiles",
        description : "List all files in a directory and its subdirectories.",
        parameters : {
            type : "object" as const ,
            properties : {
                dir : {
                    type : "string" as const ,
                    description : "The directory to list files from.",
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


