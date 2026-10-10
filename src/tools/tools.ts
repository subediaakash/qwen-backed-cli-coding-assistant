import type {Tool} from 'ollama';
import {listFiles} from './core/list_files.ts';
import {readWorkspaceFile} from './core/read_files.ts';
import {gitDiffFile, gitDiffSummary, gitLog, gitReadFile} from './core/git.ts';

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
        description : "Read the text contents of a single file inside the workspace (max 100 KB). Use ListFiles first to find the exact path. When reviewing changes between refs, pass ref (the head branch or commit) to read the file as it is on that branch instead of on disk.",
        parameters : {
            type : "object" as const ,
            properties : {
                path : {
                    type : "string" as const ,
                    description : "File path relative to the workspace root, e.g. \"src/index.ts\".",
                },
                ref : {
                    type : "string" as const ,
                    description : "Optional branch, tag, or commit to read the file at, e.g. the PR head. Omit to read the file on disk.",
                },
            },
            required : ["path"],
        },
        func : async (args: { path: string; ref?: string }) => {
            return args.ref ? await gitReadFile({ ref: args.ref, path: args.path }) : await readWorkspaceFile(args);
        },
    },
    {
        type : "function" as const ,
        name :"GitDiff",
        description : "Summarize what a PR changed: every changed file with its status (A added, M modified, D deleted) and lines added/deleted, compared against the merge base of base and head. Generated lockfiles are listed under \"ignored\" and should not be reviewed. Call this first, then GitDiffFile for individual files.",
        parameters : {
            type : "object" as const ,
            properties : {
                base : {
                    type : "string" as const ,
                    description : "Base ref the PR merges into, e.g. \"main\".",
                },
                head : {
                    type : "string" as const ,
                    description : "PR branch or commit to review. Defaults to \"HEAD\".",
                },
            },
            required : ["base"],
        },
        func : async (args: { base: string; head?: string }) => {
            return await gitDiffSummary(args);
        },
    },
    {
        type : "function" as const ,
        name :"GitDiffFile",
        description : "Show the unified diff of a single file changed by the PR (base...head). Use paths exactly as returned by GitDiff.",
        parameters : {
            type : "object" as const ,
            properties : {
                base : {
                    type : "string" as const ,
                    description : "Base ref the PR merges into, e.g. \"main\".",
                },
                head : {
                    type : "string" as const ,
                    description : "PR branch or commit to review. Defaults to \"HEAD\".",
                },
                path : {
                    type : "string" as const ,
                    description : "Changed file path relative to the workspace root, e.g. \"src/index.ts\".",
                },
            },
            required : ["base", "path"],
        },
        func : async (args: { base: string; head?: string; path: string }) => {
            return await gitDiffFile(args);
        },
    },
    {
        type : "function" as const ,
        name :"GitLog",
        description : "List the commits in the PR (on head but not on base), newest first, with hash, author, subject and body. Commit messages describe what the change is meant to do.",
        parameters : {
            type : "object" as const ,
            properties : {
                base : {
                    type : "string" as const ,
                    description : "Base ref the PR merges into, e.g. \"main\".",
                },
                head : {
                    type : "string" as const ,
                    description : "PR branch or commit to review. Defaults to \"HEAD\".",
                },
            },
            required : ["base"],
        },
        func : async (args: { base: string; head?: string }) => {
            return await gitLog(args);
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


