# 0009. Rust is not used

- **Status:** Accepted
- **Date:** 2026-11-04

## Context
Rust was considered for its safety.

## Decision
Rejected. It would mean a rewrite instead of a port ([0001](0001-port-dont-rewrite.md)), needs a third kit, and there is no performance need. Its security benefits are mostly covered by containers, a small attack surface and dependency auditing ([0015](0015-dependency-auditing.md)).

## Consequences
- The stack stays TypeScript and Python ([0006](0006-stack.md)).
- A single self-contained module could still use another language later, because the contracts make modules language-independent.
