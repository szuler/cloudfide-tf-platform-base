// Pure logic for the (optional, local) mutation check: a small set of security/behaviour
// mutations and how to apply one to a module's Terraform source. A good test suite should
// FAIL when the code is mutated; a mutation the tests still pass under is a coverage gap.
export interface Mutation {
  name: string;
  pattern: RegExp;
  replace: string;
}

export const DEFAULT_MUTATIONS: Mutation[] = [
  { name: "tls-downgrade", pattern: /"TLS1_2"/, replace: '"TLS1_0"' },
  { name: "network-open", pattern: /"Deny"/, replace: '"Allow"' },
  {
    name: "public-blob-on",
    pattern: /allow_nested_items_to_be_public(\s*=\s*)false/,
    replace: "allow_nested_items_to_be_public$1true",
  },
  {
    name: "shared-key-on",
    pattern: /shared_access_key_enabled(\s*=\s*)false/,
    replace: "shared_access_key_enabled$1true",
  },
  {
    name: "https-traffic-off",
    pattern: /https_traffic_only_enabled(\s*=\s*)true/,
    replace: "https_traffic_only_enabled$1false",
  },
  { name: "https-only-off", pattern: /https_only(\s*=\s*)true/, replace: "https_only$1false" },
  {
    name: "purge-protection-off",
    pattern: /purge_protection_enabled(\s*=\s*)true/,
    replace: "purge_protection_enabled$1false",
  },
  {
    name: "rbac-off",
    pattern: /rbac_authorization_enabled(\s*=\s*)true/,
    replace: "rbac_authorization_enabled$1false",
  },
];

/** Apply the first occurrence of a mutation to file content. */
export function applyMutation(content: string, m: Mutation): { applied: boolean; result: string } {
  if (!m.pattern.test(content)) return { applied: false, result: content };
  return { applied: true, result: content.replace(m.pattern, m.replace) };
}
