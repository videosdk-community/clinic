/** "Dr. Rao" for running copy; headers carry the full name. */
export const drShort = (name: string) => `Dr. ${name.trim().split(/\s+/).pop() ?? name}`

/** The first word of the name the patient typed. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name
