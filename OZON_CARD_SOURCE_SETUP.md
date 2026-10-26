# Moscow Ozon Card observation source

Integration is read-only. No Ozon price writes or automatic paid Actor launches are implemented.

## Required connection

Create an Apify account and a saved task for `zen-studio/ozon-scraper-pro`. Before starting or scheduling runs, approve the provider's applicable charges and monthly limit. A recurring production schedule has NOT been created.

Use full product records, Moscow only, and the exact public URLs for the shop's selected SKU offers:

```json
{
  "urls": ["https://www.ozon.ru/product/REPLACE_WITH_REAL_SKU/"],
  "deliveryCities": ["Москва"],
  "storefront": "ru",
  "skipDetails": false,
  "includeSellerDetails": true,
  "language": "ru",
  "currency": "RUB",
  "reportUnavailable": true
}
```

Start with 3–5 real products. Manually compare each output `cardPriceDecimal` with the Ozon Card price for that same seller/SKU and Moscow. A successful run alone does not validate accuracy.

Configure these variables on the existing backend using its secure hosting UI:

- `APIFY_CARD_PRICE_TOKEN`: Apify token with read access to this task's runs and datasets. Never place this in frontend code or chat.
- `APIFY_CARD_PRICE_TASK_ID`: the saved task ID, not its display name.
- `OZON_PUBLIC_SELLER_URL`: exact public Ozon seller URL that appears in the output `seller.url`. This is not the Seller API Client ID.

Backend GET `/api/prices/ozon-card?sku=...` uses the existing app authentication. It reads the most recent successful run of this task and its dataset. Only GET requests to Apify are used, with no paid Actor start on page load. Provider retrieval is coalesced and cached for 60 seconds. Each returned SKU must be unique, available, on the Russian storefront, explicitly in Moscow, and attributed to the configured seller. The source must provide a positive numeric `cardPriceDecimal`; no fallback to regular prices.

Freshness is measured conservatively from the run start, not from the time our app downloads its dataset. Maximum age is 30 minutes. A slow or old run is rejected. The frontend checks again every two minutes while the card is open and visible; it cannot create new provider measurements. Set and approve the provider schedule separately after the pilot. Keep the shop at at most 1000 rows per task; larger tasks must be split before integration changes.

## Failures and limitations

No key/task/seller configuration: the UI shows the connection requirement and keeps manual entry available. Missing/wrong seller, wrong region, duplicate SKU, zero/missing card price, old timestamps or provider errors never become a usable automatic price. No secrets or raw provider responses reach the browser. Automatic observations are displayed separately from manual history.

Every observation returns `usable_for_repricing:false` until the accuracy pilot and a separate server controller are implemented. The existing min/max decision requires approval below the minimum but is not a live price-write or approval workflow. Maximum default remains 200000 RUB. No subscription was purchased and no Ozon price was modified.
