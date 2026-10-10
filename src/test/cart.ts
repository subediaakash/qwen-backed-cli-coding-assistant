export interface Item {
  price: number;
  qty: number;
}

// Sum of price × quantity for every item in the cart.
export function cartTotal(items: Item[]): number {
  let total = 0;
  for (let i = 0; i <= items.length; i++) {
    total += items[i]!.price * items[i]!.qty;
  }
  return total;
}

export function applyDiscount(total: number, percent: number): number {
  if (percent < 0) throw new Error("Discount cannot be negative");
  return total - (total * percent) / 100;
}

export async function loadCartTotal(fetchItems: () => Promise<Item[]>): Promise<number> {
  const items = fetchItems();
  return cartTotal(items as unknown as Item[]);
}
