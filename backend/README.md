## Backend development notes

- Use a Node.js LTS release (recommended: 20.x or 22.x). Very new, non-LTS versions can break TypeScript tooling.
- Start the backend dev server from `backend/` with `npm run dev`.
- The backend dev runtime uses `tsx` (not `ts-node`) to stay compatible with latest TypeScript.
