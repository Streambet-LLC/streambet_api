# TypeScript Type Safety Guidelines

This document outlines common TypeScript type safety patterns to help prevent linting errors and improve code quality.

## Common Issues and Solutions

### 1. Unsafe Member Access (`@typescript-eslint/no-unsafe-member-access`)

When accessing properties on `any` typed objects:

```typescript
// ❌ Unsafe
function processUser(user: any) {
  console.log(user.name); // Error: Unsafe member access .name on an `any` value
}

// ✅ Safe
function processUser(user: any) {
  // Option 1: Type assertion
  console.log((user as { name: string }).name);
  
  // Option 2: Type guard
  if (typeof user === 'object' && user !== null && 'name' in user) {
    console.log(user.name);
  }
}

// ✅ Even better: Define an interface
interface User {
  name: string;
  email: string;
}

function processUser(user: User) {
  console.log(user.name); // Safe!
}
```

### 2. Unsafe Assignment (`@typescript-eslint/no-unsafe-assignment`)

When assigning `any` typed values:

```typescript
// ❌ Unsafe
const userData: any = fetchUserData();
const name = userData.name; // Error: Unsafe assignment of an `any` value

// ✅ Safe
const userData: any = fetchUserData();
const name = userData.name as string;

// ✅ Even better: Type assertion at the source
const userData = fetchUserData() as User;
const name = userData.name; // Safe!
```

### 3. Unsafe Arguments (`@typescript-eslint/no-unsafe-argument`)

When passing `any` typed values to functions:

```typescript
// ❌ Unsafe
function updateUser(userId: string, data: User) {
  // ...
}
updateUser(req.user.id, req.body); // Error: Unsafe argument of type `any`

// ✅ Safe
updateUser(req.user.id as string, req.body as User);

// ✅ Even better: Validate and transform
const userData = validateUserData(req.body);
updateUser(req.user.id as string, userData);
```

### 4. Promise Handling (`@typescript-eslint/no-floating-promises`)

When working with promises:

```typescript
// ❌ Unsafe
this.userService.updateUser(userId); // Error: Promises must be awaited

// ✅ Safe - Option 1: await
await this.userService.updateUser(userId);

// ✅ Safe - Option 2: void operator
void this.userService.updateUser(userId);

// ✅ Safe - Option 3: then/catch
this.userService
  .updateUser(userId)
  .then(() => console.log('User updated'))
  .catch(err => console.error(err));
```

### 5. Async Methods (`@typescript-eslint/require-await`)

When using async functions without await:

```typescript
// ❌ Unsafe
async function getUserData() {
  return fetchData(); // Error: Async method has no 'await' expression
}

// ✅ Safe
async function getUserData() {
  return await fetchData();
}

// Or remove async if not needed
function getUserData() {
  return fetchData();
}
```

### 6. Error Handling

When working with errors:

```typescript
// ❌ Unsafe
try {
  // something
} catch (error) {
  console.log(error.message); // Error: Unsafe member access .message
}

// ✅ Safe
try {
  // something
} catch (error) {
  if (error instanceof Error) {
    console.log(error.message);
  } else {
    console.log('Unknown error');
  }
}
```

### 7. WebSocket Communication

When working with Socket.io:

```typescript
// ❌ Unsafe
@SubscribeMessage('event')
handleEvent(client: Socket, data: any) {
  console.log(client.data.user.id); // Multiple unsafe operations
}

// ✅ Safe
// Define proper interfaces
interface AuthenticatedSocket extends Socket {
  data: {
    user: JwtPayload;
  };
}

interface EventData {
  message: string;
  roomId: string;
}

@SubscribeMessage('event')
handleEvent(
  @ConnectedSocket() client: AuthenticatedSocket,
  @MessageBody() data: EventData
) {
  console.log(client.data.user.id); // Safe!
}
```

## Best Practices

1. **Define interfaces** for all data structures
2. **Use type guards** when working with dynamic data
3. **Properly handle promises** with await, void, or then/catch
4. **Properly handle errors** with instanceof checks
5. **Avoid using `any`** whenever possible
6. **Use proper request/response typing** in controllers
7. **Add type definitions** to function parameters and return values

By following these patterns, you can significantly reduce TypeScript linting errors and improve code quality. 