// Errors whose message is the whole story (bad spec, missing key/tool, budget):
// the CLI prints the message without a stack trace.
export class UserError extends Error {}
