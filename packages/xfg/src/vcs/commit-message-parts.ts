export interface CommitMessageParts {
  headline: string;
  body?: string;
}

export function splitCommitMessage(message: string): CommitMessageParts {
  const newline = message.indexOf("\n");
  if (newline === -1) return { headline: message };
  const headline = message.slice(0, newline);
  const body = message.slice(newline + 1).trim();
  return body ? { headline, body } : { headline };
}
