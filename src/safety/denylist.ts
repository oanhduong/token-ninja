/**
 * Hard deny-list of patterns that MUST fall back to the AI tool and never
 * execute locally. If the input (or any pipeline segment) matches ANY of
 * these, the classifier refuses to handle it — regardless of whether a rule
 * would otherwise claim the command.
 *
 * Each entry is a regex tested against a single pipeline segment (already
 * split by splitPipelineSegments). Regexes are case-insensitive and anchored
 * with word boundaries where a literal command name would otherwise be a
 * substring of a harmless token.
 */

export interface DenyPattern {
  id: string;
  pattern: RegExp;
  reason: string;
}

export const DENY_PATTERNS: DenyPattern[] = [
  // rm danger zones
  {
    id: "rm-rf",
    pattern: /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-rf|-fr|--recursive\s+--force|--force\s+--recursive)\b/i,
    reason: "rm -rf is too destructive to run without AI review",
  },
  {
    id: "rm-wildcard-recursive",
    pattern: /\brm\s+-[a-z]*r[a-z]*\s+.*[*?]/i,
    reason: "rm -r with wildcards",
  },
  {
    id: "rm-system-path",
    pattern: /\brm\s+.*\s+(?:\/|~|\$HOME|\/etc|\/usr|\/var|\/boot|\/bin|\/sbin|\/lib|\/opt|\/root|\/sys|\/proc|\/dev)(?:\s|\/|$)/i,
    reason: "rm on system paths",
  },

  // privilege escalation
  {
    id: "sudo",
    pattern: /(?:^|\s)(?:sudo|doas)\b/i,
    reason: "privilege escalation",
  },
  { id: "su", pattern: /(?:^|\s)su\s+-\b/i, reason: "privilege escalation" },
  { id: "su-bare", pattern: /^su(?:\s|$)/i, reason: "privilege escalation" },

  // pipe to shell
  {
    id: "pipe-to-shell",
    pattern: /\b(?:curl|wget|fetch)\b[^\n]*\|\s*(?:bash|sh|zsh|dash|ksh)\b/i,
    reason: "curl|sh style remote execution",
  },
  {
    id: "base64-to-shell",
    pattern: /\bbase64\s+(?:-d|--decode)\b[^\n]*\|\s*(?:bash|sh|zsh)\b/i,
    reason: "base64-decoded shell execution",
  },
  {
    id: "xxd-to-shell",
    pattern: /\bxxd\s+-r[^\n]*\|\s*(?:bash|sh|zsh)\b/i,
    reason: "xxd-decoded shell execution",
  },
  {
    id: "eval-untrusted",
    pattern: /\beval\s+["'`]?\$\(/i,
    reason: "eval of command substitution",
  },

  // disk destruction
  { id: "dd-if", pattern: /\bdd\s+if=/i, reason: "dd can destroy disks" },
  { id: "mkfs", pattern: /\bmkfs(?:\.|\s)/i, reason: "filesystem format" },
  { id: "fdisk", pattern: /\bfdisk\b/i, reason: "partition table modification" },
  { id: "parted", pattern: /\bparted\b/i, reason: "partition modification" },
  { id: "wipefs", pattern: /\bwipefs\b/i, reason: "filesystem signature wipe" },
  { id: "shred", pattern: /\bshred\b/i, reason: "irreversible file destruction" },

  // system path writes
  {
    id: "redirect-system-path",
    pattern: /[>]{1,2}\s*(?:\/etc|\/usr|\/boot|\/bin|\/sbin|\/lib|\/opt|\/var|\/root|\/sys|\/proc|\/dev)(?:\s|\/|$)/i,
    reason: "redirect to system path",
  },

  // chmod/chown on system paths
  {
    id: "chmod-777-system",
    pattern: /\bchmod\s+(?:-R\s+)?(?:0?777|a\+[rwx]+|a=rwx)\b.*(?:\/etc|\/usr|\/boot|\/bin|\/sbin|\/lib|\/opt|\/var|\/root|\/sys|\/proc|\/dev|\/)/i,
    reason: "chmod 777 on system path",
  },
  {
    id: "chown-system",
    pattern: /\bchown\b.*(?:\/etc|\/usr|\/boot|\/bin|\/sbin|\/lib|\/opt|\/var|\/root|\/sys|\/proc|\/dev)(?:\s|\/|$)/i,
    reason: "chown on system path",
  },

  // git danger
  {
    id: "git-push-force",
    pattern: /\bgit\s+push\b[^\n]*(?:--force(?!-with-lease)|(?<!\S)-f(?!\S))/i,
    reason: "git push --force",
  },
  {
    id: "git-reset-hard",
    pattern: /\bgit\s+reset\s+--hard\b/i,
    reason: "git reset --hard can destroy uncommitted work",
  },
  {
    id: "git-clean-fdx",
    pattern: /\bgit\s+clean\s+-[a-z]*f[a-z]*d[a-z]*x|git\s+clean\s+-[a-z]*f[a-z]*x[a-z]*d|git\s+clean\s+-[a-z]*x[a-z]*f[a-z]*d|git\s+clean\s+-[a-z]*x[a-z]*d[a-z]*f|git\s+clean\s+-[a-z]*d[a-z]*f[a-z]*x|git\s+clean\s+-[a-z]*d[a-z]*x[a-z]*f/i,
    reason: "git clean -fdx is destructive",
  },
  {
    id: "git-checkout-dot",
    pattern: /\bgit\s+checkout\s+(?:--\s+)?\.$/i,
    reason: "git checkout . discards local changes",
  },

  // publishing (= side effects outside machine)
  { id: "npm-publish", pattern: /\bnpm\s+publish\b/i, reason: "publishing requires AI review" },
  { id: "yarn-publish", pattern: /\byarn\s+publish\b/i, reason: "publishing requires AI review" },
  { id: "pnpm-publish", pattern: /\bpnpm\s+publish\b/i, reason: "publishing requires AI review" },
  { id: "cargo-publish", pattern: /\bcargo\s+publish\b/i, reason: "publishing requires AI review" },
  { id: "gem-push", pattern: /\bgem\s+push\b/i, reason: "publishing requires AI review" },
  { id: "poetry-publish", pattern: /\bpoetry\s+publish\b/i, reason: "publishing requires AI review" },
  { id: "twine-upload", pattern: /\btwine\s+upload\b/i, reason: "publishing requires AI review" },

  // sql destruction
  {
    id: "sql-drop",
    pattern: /\b(?:drop\s+(?:table|database|schema|index|view))\b/i,
    reason: "SQL DROP",
  },
  { id: "sql-truncate", pattern: /\btruncate\s+table\b/i, reason: "SQL TRUNCATE" },
  {
    // Flag `DELETE FROM x` unless a WHERE clause follows somewhere later in the
    // same command. The \b after the table name works around quoted SQL.
    id: "sql-delete-nowhere",
    pattern: /\bdelete\s+from\s+\w+\b(?![^;]*\bwhere\b)/i,
    reason: "DELETE without WHERE",
  },
  {
    id: "sql-update-nowhere",
    pattern: /\bupdate\s+\w+\s+set\b(?![^;]*\bwhere\b)/i,
    reason: "UPDATE without WHERE",
  },

  // docker/k8s blast radius
  {
    // Matches `-af`, `-fa`, `--all --force`, `--force --all`, and the
    // independent-flag variants regardless of order.
    id: "docker-prune-af",
    pattern: /\bdocker\s+system\s+prune\b[^\n]*(?:-(?=[a-z]*a)(?=[a-z]*f)[a-z]+|-(?=[a-z]*f)(?=[a-z]*a)[a-z]+|(?:-a|--all)[^\n]*(?:-f|--force)|(?:-f|--force)[^\n]*(?:-a|--all))/i,
    reason: "docker system prune -af",
  },
  {
    id: "kubectl-delete",
    pattern: /\bkubectl\s+delete\b/i,
    reason: "kubectl delete requires confirmation",
  },

  // shell features that usually indicate obfuscation
  {
    id: "process-substitution-to-shell",
    pattern: /<\(.*\)\s*\|\s*(?:bash|sh)\b/i,
    reason: "process substitution piped to shell",
  },
];

export function findDenyMatches(segment: string): DenyPattern[] {
  const hits: DenyPattern[] = [];
  for (const p of DENY_PATTERNS) {
    if (p.pattern.test(segment)) hits.push(p);
  }
  return hits;
}
