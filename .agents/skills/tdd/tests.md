# Behavior-focused tests

A useful test names a behavior and asserts an independently known outcome.
Several assertions can establish one scenario, including its side effects and
absence of unintended effects.

```typescript
test("checkout confirms the order", async () => {
  const cart = createCart();
  cart.add(product);
  const result = await checkout(cart, paymentMethod);
  expect(result.status).toBe("confirmed");
  expect((await getOrder(result.orderId)).status).toBe("confirmed");
});
```

An assertion that only checks an internal method was called usually leaves the
user-visible result unverified. Call counts and ordering are appropriate when
the contract itself concerns duplicate charges, publication order, or exclusion
of concurrent work.

## Persistence and private details

For ordinary CRUD behavior, verify through the read interface:

```typescript
const user = await createUser({ name: "Alice" });
expect((await getUser(user.id)).name).toBe("Alice");
```

For migration, storage growth, byte fidelity, and crash recovery, the persisted
representation can itself be the requirement. Inspect it directly when needed,
then verify that the migrated or recovered store remains usable through its
normal interface. Avoid adding a public production method solely for inspection.

## Independent expectations

This repeats the calculation and can reproduce the same mistake:

```typescript
const expected = items.reduce((sum, item) => sum + item.price, 0);
expect(calculateTotal(items)).toBe(expected);
```

A known result provides an independent check:

```typescript
expect(calculateTotal([{ price: 10 }, { price: 5 }])).toBe(15);
```

## Choosing integration coverage

A helper test can pass while the actual caller skips the helper. For state,
lifecycle, or persistence bugs, trace the caller-to-effect path and exercise the
relevant integration. A focused regression and one targeted end-to-end check
can cover different failure modes; avoid duplicating the same assertion at
every layer.
