# Proxy Merchant R35 · Operating Home

The merchant Home follows:

`Outcome → Operating Pulse → Demand × Supply → Best Next Decision → Forecast → Action → Outcome`

The first implementation slice is conservative and server-authoritative:

- Recorded seven-day orders, gross value and customer counts are projected from `spend_daily`.
- Store and operating-member counts come from the business repository.
- Until privacy-thresholded aggregate demand and Scene-capacity inputs exist, demand balance is `INSUFFICIENT_SIGNAL`, forecast is `UNAVAILABLE`, and the decision is `NO_ACTION`.
- The mobile UI must display those unavailable/low-confidence states. It must not infer nearby demand or precise future occupancy from historical sales.
- Creator recommendations continue through the eligible Supply query; activities continue through the Activity service.

Remaining R35 work: ingest privacy-safe aggregate demand, Scene supply snapshots, versioned forecasts and expectation history, then evaluate intervention decisions without overwriting previous expectations.

The server resolver is already frozen: below-threshold demand fails closed;
future capacity can produce `STOP_TRAFFIC` even when current occupancy is
comfortable; balanced inputs preserve `NO_ACTION` as a first-class result.
