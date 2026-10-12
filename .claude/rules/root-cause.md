# Root Cause

Fix the source of a problem, not its symptom.

- Trace the failure to where it starts (the code, config, tool or upstream project that produces it) before changing anything.
- If you can reach the source, fix it there: this repo, another repo the owner controls, or a setting.
- Only when the source is out of reach (an upstream project or vendor): link the upstream issue, keep the workaround small, and say when to remove it.
- Never silence a check, add a retry, raise a timeout or special-case one input to make a failure go away without knowing why it failed.
