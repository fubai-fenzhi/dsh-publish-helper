export const DEFAULT_ORG = 'dsh-fubai';

/** Build the `npm org ...` arguments used for member management. */
export function orgArgs({ action, org, user, role = 'developer', otp } = {}) {
  const name = String(org ?? '').trim();
  if (!name) throw new Error('org is required');
  const args = [];
  if (action === 'list') {
    args.push('org', 'ls', name);
  } else if (action === 'verify') {
    if (!user) throw new Error('user is required for verify');
    args.push('org', 'ls', name, user);
  } else if (action === 'invite') {
    if (!user) throw new Error('user is required for invite');
    args.push('org', 'set', name, user, role);
  } else if (action === 'remove') {
    if (!user) throw new Error('user is required for remove');
    args.push('org', 'rm', name, user);
  } else {
    throw new Error(`unknown org action: ${action}`);
  }
  if (otp) args.push('--otp', String(otp));
  return args;
}
