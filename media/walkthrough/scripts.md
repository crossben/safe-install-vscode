# Review install scripts

Install with `safe-install` (instead of `npm install`) so no install script runs on its
own. The **Install Scripts** view in the Explorer then lists the packages that want to run
one.

**Approve…** shows exactly what would run and its findings, then runs
`safe-install approve` in a terminal you can see. High-risk scripts are never approved from
the editor.
