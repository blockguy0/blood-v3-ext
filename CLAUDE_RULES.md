# Claude Development Rules for Blood Extension

## MANDATORY RULES

### 1. API Changes
**ALWAYS** check MCP documentation before adding or modifying any API endpoint:
```
mcp__gitbook__searchDocumentation("endpoint name")
```
- Never assume an endpoint exists
- Never create endpoints that don't exist in Blood API
- Verify request method (GET/POST/PATCH/DELETE)
- Verify request/response structure

### 2. Available Blood API Endpoints (verified)

#### Tasks
- `GET /tasks/` - Get all tasks grouped by categories
- `POST /tasks/` - Register tasks
- `POST /tasks/{task_id}` - Start a specific task by ID
- `PATCH /tasks/{task_id}` - Stop a specific task by ID
- `DELETE /tasks/{task_id}` - Delete a specific task by ID
- `POST /tasks/idle/start` - Start all idle tasks

#### Health
- `GET /health` - Health check

#### Feed
- `POST /feed` - Trigger feed mode tasks

#### Positions
- `GET /positions/` - Get positions
- `POST /positions/{position_id}/hide` - Hide position
- `POST /positions/{position_id}/activate` - Activate position

#### WL/BL
- `GET /wlbl` - Get WL/BL wallets
  - Response: `{ wallets: [{ address, group_id, is_whitelisted, is_blacklisted }] }`
- `POST /wlbl` - Add WL/BL wallets
  - Request: `{ wallets: [{ address, group_id, is_whitelisted, is_blacklisted }] }`
  - Response: `{ errors: { [address]: error_message } }`
- `DELETE /wlbl/{group_id}` - Delete all wallets in group
- `DELETE /wlbl/{group_id}/{wallet_id}` - Delete wallet (wallet_id = address)

#### Wallets
- `GET /wallets/` - Get all wallets
- `GET /wallets/{wallet_id}/balance` - Get wallet SOL balance

### 3. Before Making Changes
1. Read relevant files first
2. Check MCP docs for API endpoints
3. Understand existing code patterns
4. Ask user if unsure about requirements

### 4. Code Style
- Follow existing patterns in the codebase
- Keep changes minimal and focused
- Test assumptions before implementing

### 5. Git Commits
- Only commit after verifying changes work
- Use clear, descriptive commit messages
