// ZLTAC 2027 pricing — update when official fees are confirmed
// All amounts in cents

export const MAIN_EVENT_FEE = 0 // TBC — included with team registration

export const SIDE_EVENTS = [
  {
    slug: 'lord-of-the-rings',
    name: 'Lord of the Rings',
    badge: 'Featured',
    price: 2500,
    desc: 'Epic multi-round format — only the finest warriors survive each ring to claim the ultimate title.',
    highlight: true,
  },
  {
    slug: 'solos',
    name: 'Solos',
    badge: 'Individual',
    price: 2000,
    desc: 'Head-to-head individual competition. Prove you are the best single player in Australasia.',
  },
  {
    slug: 'doubles',
    name: 'Doubles',
    badge: 'Team of 2',
    price: 2000,
    desc: 'Partner with a teammate and coordinate your strategy to outmanoeuvre the field.',
  },
  {
    slug: 'triples',
    name: 'Triples',
    badge: 'Team of 3',
    price: 2000,
    desc: 'Fast-paced three-player team format. Communication and chemistry decide the winners.',
  },
]

export const SIDE_PRICES = Object.fromEntries(SIDE_EVENTS.map(e => [e.slug, e.price]))

export const DINNER_GUEST_PRICE = 6500 // per additional guest

export function calcTotal(sideEventSlugs, dinnerGuests) {
  const sideTotal = sideEventSlugs.reduce((sum, slug) => sum + (SIDE_PRICES[slug] ?? 0), 0)
  return MAIN_EVENT_FEE + sideTotal + dinnerGuests * DINNER_GUEST_PRICE
}

export function dollars(cents) {
  return `$${(cents / 100).toFixed(2)}`
}
