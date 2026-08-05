export function createTargetAdapter() {
  return {
    supports: () => false,
    async execute(actionId) {
      throw new Error(`Target SDK method unavailable for ${actionId}`);
    },
  };
}
