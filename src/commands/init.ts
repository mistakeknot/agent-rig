import chalk from "chalk";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

async function ask(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultVal?: string,
): Promise<string> {
  return new Promise((resolve) => {
    const prompt = defaultVal ? `${question} (${defaultVal}): ` : `${question}: `;
    rl.question(prompt, (answer) =>
      resolve(answer.trim() || defaultVal || ""),
    );
  });
}

export async function initCommand(dir: string) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log(chalk.bold("\nCreate a new agent-rig.json\n"));

  const name = await ask(rl, "Rig name (kebab-case)", "my-rig");
  const version = await ask(rl, "Version", "0.1.0");
  const description = await ask(rl, "Description", "My agent rig");
  const author = await ask(rl, "Author");

  rl.close();

  const manifest = {
    name,
    version,
    description,
    author,
    license: "MIT",
    plugins: {
      required: [] as unknown[],
      recommended: [] as unknown[],
      conflicts: [] as unknown[],
    },
    mcpServers: {},
    tools: [] as unknown[],
    platforms: {
      "claude-code": {
        marketplaces: [] as unknown[],
      },
    },
  };

  const outPath = join(dir, "agent-rig.json");
  await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(chalk.green(`\nCreated ${outPath}`));
  console.log(chalk.dim("Edit this file to add plugins, MCP servers, and tools."));
  console.log(chalk.dim("Validate with: agent-rig validate"));
}
