/**
 * Reserved ObjectId hex string for the internal "System" identity.
 * Used for inter-service communication and bypass-auth internal routes.
 * Using 24 'f' characters ensures it's a valid hex but practically never generated as a random ID.
 */
export const SYSTEM_IDENTITY = 'ffffffffffffffffffffffff'
