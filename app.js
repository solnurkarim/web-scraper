require('dotenv').config();
const req = require('request');
const req_p = require('request-promise');
const bb = require('bluebird');

const src_url = 'https://www.olx.kz/elektronika/telefony-i-aksesuary/mobilnye-telefony-smartfony/alma-ata';
const cheerio = require('cheerio');

const db_client = require('mongodb').MongoClient;

const req_opts = {
    method: 'GET',
    url: src_url,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36',
    }
}

let pages_num = 0;

let products_count = 0;
let products = [];
let product_links = [];

function Req_offers_page(body) {
    const $ = cheerio.load(body);
    const product_elems_link = $('.rel.listHandler .offer-wrapper .title-cell .detailsLink');

    product_elems_link.each((ind, elem) => {
        const product_url = $(elem).attr('href');
        product_links.push(product_url);
    })

    console.log(product_elems_link.length);
}

function Req_offers_category(err, res, body) {
    if (!err) {
        const $ = cheerio.load(body);
        pages_num = $('.pager .item.fleft a span').last().text().trim();
        // pages_num = Number(pages_num);
        pages_num = 10;
        console.log('Pages found: ' + pages_num);

        Parse_list_pages();
    } else {
        console.log(err)
    }
}

function Parse_list_pages() {
    let opts_lists = [];
    for (i = 0; i < pages_num; i++) {
        const req_opts_page = Object.assign({}, req_opts);
        req_opts_page.url += '?page=' + (i + 1);
        opts_lists.push(req_opts_page);
    }

    bb.map(opts_lists, function (opts_list) {
        return req_p(opts_list).then(function (list_html) {
            console.log(list_html.length);
            Req_offers_page(list_html);
        })
    }, {
        concurrency: 5
    }).then(function () {
        console.log('Links found: ' + product_links.length);
        setTimeout(Parse_products);
    }).catch(function (err) {
        console.log(err);
    })
}



function Parse_products() {
    console.log('Parsing products...');

    bb.map(product_links, function (product_link) {
        product_link_opts = Object.assign({}, req_opts);
        product_link_opts.url = product_link;

        return req_p(product_link_opts).then(function (product_html) {
            Parse_product_details(product_html);
        })
    }, {
        concurrency: 5
    }).then(function () {
        console.log('Products parsed: ' + products_count);
        Store_products();
    }).catch(function (err) {
        console.log(err);
    })
}


function Parse_product_details(html) {
    const $ = cheerio.load(html);
    const product_title = $('.offer-titlebox h1').text().trim();
    const product_price = $('.price-label strong').text().trim();
    const product_details_rows = $('.details .item tr');

    let product = {
        name: product_title,
        price: Int(product_price)
    }

    product_details_rows.each((ind, detail) => {
        const detail_name = $(detail).children('th').text().trim();
        const detail_val = $(detail).find('td strong a').text().trim();

        if (detail_name == 'Марка телефона') product.model = detail_val;
        if (detail_name == 'Операционная система') product.os = detail_val;
    })

    products_count++;
    products.push(product);
}


function Store_products() {
    console.log('Storing products to DB...');
    db_client.connect(process.env.DB_URL, {
        useNewUrlParser: true
    }, function (err, client) {
        if (!err) {
            const db = client.db('kaz');
            const phones = db.collection('phones');

            phones.insertMany(products, function (err, result) {
                if (!err) {
                    console.log('Products stored to DB: ' + JSON.parse(result).n);
                } else return console.log(err);
            })

            client.close();
        } else return console.log(err);
    });
}


function Int(str) {
    var int = str.replace(/[^0-9]/g, '');

    return Number(int);
}

req(req_opts, Req_offers_category);