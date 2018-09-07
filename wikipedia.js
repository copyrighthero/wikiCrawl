// Hansheng Zhao <copyrighthero@gmail.com> (https://www.zhs.me)
'use strict';

// require libraries
const fs = require('fs');
const ini = require('ini');
const ejs = require('ejs');
const zlib = require('zlib');
const uuid = require('uuid/v4');
const lodash = require('lodash');
const leveldb = require('level');
const cheerio = require('cheerio');
const parsoid = require('parsoid');
const request = require('request');
const wtfwiki = require('wtf_wikipedia');

// global storage
const storage = {
  leveldb: null
};

// load config file content
const loadConfig = (filePath = './config.ini') =>
  ini.parse(fs.readFileSync(filePath, 'UTF8'));

// load LevelDB database
const loadLevelDB = filePath => {
  if (storage.leveldb) { return storage.leveldb; }
  else { return storage.leveldb = leveldb(filePath); }
};

// compress textual content
const compressContent = content => new Promise((resolve, reject) => {
  zlib.gzip(content, (error, buffer) => {
    if (error) { reject(error); }
    resolve(buffer.toString('base64'));
  });
});

// acquire lasted wikipedia revision content
const wikipediaRevision = title => new Promise((resolve, reject) => {
  // wikipedia api endpoint
  const endpoint = 'https://en.wikipedia.org/w/api.php' +
    '?action=query&prop=revisions&rvprop=content&rvslots=main' +
    '&rvlimit=1&redirects&format=json&formatversion=2&titles=TITLE';
  // request for wikipedia entry
  request({
    uri: endpoint.replace('TITLE', encodeURIComponent(title)),
    headers: {'User-Agent': uuid().replace(/-/g, '').toUpperCase()}
  }, (error, response, body) => {
    if (error) {
      console.error('Error request issued.', error);
      reject(error);
    }
    if (response && response.statusCode === 200) {
      body = JSON.parse(body);
      const [page] = body.query.pages;
      resolve(page.missing ? '' : (
        !(page.revisions && page.revisions.length) ? '' :
        page.revisions.pop().slots.main.content.replace(/\s+/g, ' ')
      ));
    } else {
      console.error('Error response issued.', response);
      wikipediaRevision(title).then(resolve, reject);
    }
  });
});

// parse Wikitext into HTML and plaintext
const parseWikitext = async wikitext => {
  // parse wikitext into html
  const {out: raw} = await parsoid.parse(wikitext);
  // parse html using cheerio
  const doc = cheerio.load(raw);
  doc('style').remove();
  // acquire sanitized html and plaintext
  const html = doc.html().replace(/\s+/g, ' ');
  const text = doc.text().replace(/\s+/g, ' ');
  // acquire infobox as kv pair
  const wtf = wtfwiki(wikitext);
  const info = lodash.isEmpty(wtf.infobox()) ? {} : wtf.infobox().keyValue();
  // acquire all unique wiki links
  const link = lodash.uniq(lodash.map(lodash.filter(doc('a'), item =>
    !item.attribs.href.includes('#') && item.attribs.href.startsWith('./')
  ), item => item.attribs.href.substr(2)));
  // return parsed information
  return {html, text, info, link};
};

// bootstrap crawling process
void (async (filePath = './config.ini') => {
  // variable definition
  const ledger = new Set();
  // load config file
  const config = loadConfig(filePath);
  const {template, start, stop} = config.application;
  // load LevelDB file
  const leveldb = loadLevelDB(config.leveldb.path);
  // construct keyword generator
  const keyword = (
    template => count => template({count})
  )(ejs.compile(template));
  // iteratively acquire desired information
  for (let index of lodash.range(start, stop)) {
    // generate title
    const title = keyword(index);

    // remove current title
    ledger.delete(title);

    // LOG PROGRESS
    console.log('Acquiring info for:', title);
    // acquire wikitext
    const wiki = await wikipediaRevision(title);
    // ignore empty entry
    if (!wiki) { continue; }
    // acquire parsed information
    const {html, text, info, link} = await parseWikitext(wiki);

    // LOG PROGRESS
    console.log('Persisting info for:', title);
    // persist infomation in database
    leveldb.put(title, JSON.stringify({
      title, wiki, html, text, info, link
    }));

    // iteratively acquire subentries
    for (let item of link) {
      // check if title has been visited
      if (ledger.has(item)) { continue; }
      ledger.add(item);

      // LOG PROGRESS
      console.log('  Acquiring info for:', item);
      // acquire sub-wikitext
      const wiki = await wikipediaRevision(item);
      // ignore empty entry
      if (!wiki) { continue; }
      // acquire parsed information
      const {html, text, info, link} = await parseWikitext(wiki);

      // LOG PROGRESS
      console.log('  Persisting info for:', item);
       // persist infomation in database
      leveldb.put(item, JSON.stringify({
        title: item, wiki, html, text, info, link
      }));
    }

    // record current title
    ledger.add(title);
  }
})().then(() => {
  // successful operation
  console.log('Information collected.');
  storage.leveldb.close();
  process.exit(0);
}, error => {
  // failed operation
  console.error('Error encountered.', error);
  storage.leveldb.close();
  process.exit(1);
});
