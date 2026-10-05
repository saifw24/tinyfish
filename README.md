# Student Rail Arbitrage

Finds the smallest change to your UK train plans that produces the biggest saving. Enter a route, date, preferred time and flexibility; the app compares real departures around your time and shows how much inconvenience (minutes earlier/later, extra travel time) you need to accept to save £X.

## How TinyFish is used
- **Search**: discovers live railway journey/fare sources for the route (runs on every search).
- **Agent**: browser agents read real departures and fares from the National Rail journey planner in 2-hour time slots; results are cached per slot so repeat searches are instant (with retrieval time shown).
- **Monitor**: "Create alert" sets up a TinyFish Monitor on the fare page; each check re-verifies fares with the Agent and fires an in-app (and optional email) alert when your saving target is met.

Nothing is mocked: fares that can't be verified are shown as unverified, never guessed.

## Run it
```
npm install
echo "TINYFISH_API_KEY=your_key" > .env.local
npm run dev    # http://localhost:3000
```
Tip: a first search reads fares live and takes a few minutes; press Find savings again with the same inputs (or use "Pre-load this route") and it answers in seconds.
