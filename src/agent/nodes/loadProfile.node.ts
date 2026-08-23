import type { JobAgentDependencies } from "../dependencies.js";
import type { JobAgentState } from "../state.js";

export function createLoadProfileNode(dependencies: JobAgentDependencies) {
  return async (_state: JobAgentState): Promise<Partial<JobAgentState>> => {
    console.log("[loadProfile] Starting");
    const profile = await dependencies.loadProfile();
    console.log("[loadProfile] Complete");
    return { profile };
  };
}
