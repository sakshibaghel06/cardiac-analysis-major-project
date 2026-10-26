export const missingFirebaseConfigKeys = (config) =>
  Object.entries(config)
    .filter(([, value]) => typeof value !== "string" || !value.trim())
    .map(([key]) => key);
