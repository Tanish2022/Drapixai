import fs from "node:fs";
import path from "node:path";

export function prepareComposeEnvFiles(root, gate, templates) {
  if (gate.runner !== "docker" || gate.args[0] !== "compose") return [];

  const created = [];
  try {
    for (const [template, destination] of templates) {
      const destinationPath = path.join(root, destination);
      if (fs.existsSync(destinationPath)) continue;
      fs.copyFileSync(path.join(root, template), destinationPath, fs.constants.COPYFILE_EXCL);
      created.push(destinationPath);
    }
    return created;
  } catch (error) {
    // A later copy can fail before the caller receives the cleanup list.
    for (const destinationPath of created) fs.rmSync(destinationPath, { force: true });
    throw error;
  }
}
