import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { router } from './routes.js';
import dayjs from 'dayjs';

await Actor.init();

const input = await Actor.getInput();

const {
    region,
    start_date,
    end_date,
    search_query, 
    query_type,
    maximum_results,
} = input;

const startTimeMs = new Date(start_date).getTime();
const endTimeMs = new Date(end_date).getTime();

const encodedSearch = encodeURIComponent(search_query ?? '');
const url = `https://library.tiktok.com/ads?region=${region}&start_time=${startTimeMs}&end_time=${endTimeMs}&adv_name=${encodedSearch}&adv_biz_ids=&query_type=${query_type}&sort_type=last_shown_date,desc`;

const crawler = new PlaywrightCrawler({
    requestHandler: router,
    requestHandlerTimeoutSecs: 120,
});

await crawler.run([{ url, userData: { maximum_results } }]);

await Actor.exit();