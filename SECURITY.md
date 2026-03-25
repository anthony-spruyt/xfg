# Security Policy

## Supported Versions

Only the **latest release** is supported with security updates. There are no long-term support branches.

| Version        | Supported          |
| -------------- | ------------------ |
| Latest release | :white_check_mark: |
| Older versions | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability in xfg, please report it responsibly through **GitHub Security Advisories**:

1. Go to the [Security Advisories page](https://github.com/anthony-spruyt/xfg/security/advisories/new)
2. Click **"New draft security advisory"**
3. Fill in the details of the vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

### What to expect

- **Acknowledgement**: You will receive an acknowledgement within **48 hours** of your report.
- **Updates**: You can expect status updates at least every **7 days** until the issue is resolved.
- **Resolution**: If the vulnerability is accepted, a fix will be developed and released as a patch to all supported versions. You will be credited in the advisory (unless you prefer to remain anonymous).
- **Declined reports**: If the reported issue is not considered a vulnerability (e.g., expected behavior, out of scope), you will receive an explanation of why it was declined.

### Scope

The following are in scope for security reports:

- Command injection via config values or template interpolation
- Credential leakage in logs, error messages, or PR content
- Path traversal when writing synced files
- Authentication token mishandling
- Dependency vulnerabilities with a viable exploit path

### Out of Scope

- Vulnerabilities in upstream CLIs (`git`, `gh`, `az`, `glab`) — report these to their respective maintainers
- Issues requiring physical access to the machine running xfg
- Social engineering attacks
