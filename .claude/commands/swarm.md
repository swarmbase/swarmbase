Create an agent team called "swarmdb" to work on the SwarmDB project.

Read the SWARM.md file in the repo root first to understand the agent roles and work streams.

Then create the team and spawn teammates based on the user's request. If no specific work stream is mentioned, ask the user which work stream(s) from SWARM.md they want to tackle.

## Available Agent Roles (from SWARM.md)

1. **core-library** - Core library work in `packages/collabswarm/src/`
2. **crdt-providers** - CRDT providers in `packages/collabswarm-yjs/` and `packages/collabswarm-automerge/`
3. **frontend** - React/Redux integration in `packages/collabswarm-react/` and `packages/collabswarm-redux/`
4. **networking** - Networking & infrastructure (libp2p, Docker, NAT traversal)
5. **security** - Security & cryptography (auth, ACL, keychain, encryption)
6. **testing** - Testing & quality (unit tests, E2E, CI/CD)

## Instructions

- Each teammate should be spawned with `isolation: "worktree"` so they work in isolated git worktrees
- Each teammate should be given clear scope boundaries matching their SWARM.md role
- Create tasks in the shared task list based on the relevant work stream tasks from SWARM.md
- The lead agent coordinates, reviews, and merges work from teammates
- Reference CLAUDE.md for project conventions and SPECS.md for technical specifications
- All teammates must follow the quality gates defined in SWARM.md before considering work complete

## User argument: $ARGUMENTS
