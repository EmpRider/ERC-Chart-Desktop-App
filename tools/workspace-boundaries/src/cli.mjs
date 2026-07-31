import process from "node:process";
import { validateWorkspace } from "./workspace-contract.mjs";

const errors = await validateWorkspace(process.cwd());
for (const error of errors) console.error(error);
if (errors.length > 0) process.exitCode = 1;
else console.log("Workspace boundaries: valid.");
