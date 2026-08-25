import type { SlashCommand } from "./types.js";
import { testerCommand } from "./admin/tester.js";
import { tierCommand } from "./admin/tier.js";
import { setupCommand } from "./admin/setup.js";
import { pingCommand } from "./public/ping.js";
import { profileCommand } from "./public/profile.js";
import { queueCommand } from "./queue.js";

export const commands: SlashCommand[] = [pingCommand, profileCommand, setupCommand, tierCommand, testerCommand, queueCommand];
