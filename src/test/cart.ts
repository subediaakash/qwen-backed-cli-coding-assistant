export interface Item {
  price: number;
  qty: number;
}

export function cartTotal(items: Item[]): number {
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    total += items[i]!.price * items[i]!.qty;
  }
  return total;
}

export function applyDiscount(total: number, percent: number): number {
  if (percent < 0 || percent > 100) throw new Error("Discount must be between 0 and 100");
  return total - (total * percent) / 100;
}

export async function loadCartTotal(fetchItems: () => Promise<Item[]>): Promise<number> {
  const items = await fetchItems();
  return cartTotal(items);
}
