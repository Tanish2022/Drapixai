// Vendor-reported recipient-confusion cases. Local parsing only: no credentials,
// SMTP connection, message, inbox or database access.
const assert=require('node:assert/strict');
const moduleValue=require('nodemailer/lib/addressparser');
const parse=moduleValue.default||moduleValue;
const flatten=items=>items.flatMap(item=>item.group?flatten(item.group):item.address?[item.address]:[]);
const cases=[
  {advisory:'GHSA-8c8m-p3m8-cjg8',input:'Victim (x(y) <attacker@evil.invalid>) <v@victim.invalid>'},
  {advisory:'GHSA-m943-m63m-w62w',input:'G: (a; <attacker@evil.invalid>) <v@victim.invalid>;'},
  {advisory:'GHSA-85x2-q946-cp5h',input:'<"a@evil.invalid>"@victim.invalid>'},
];
for(const test of cases){
  const addresses=flatten(parse(test.input));
  assert.equal(addresses.length,1,test.advisory);
  assert.ok(addresses[0].endsWith('@victim.invalid'),test.advisory);
  if(test.advisory!=='GHSA-85x2-q946-cp5h')assert.equal(addresses[0],'v@victim.invalid');
  console.log(`PASS ${test.advisory}: display/comment text cannot redirect the parsed recipient`);
}
assert.deepEqual(flatten(parse('recipient@example.invalid')),['recipient@example.invalid']);
console.log(`Email parser security checks passed with Nodemailer ${require('nodemailer/package.json').version}: 3 vendor regressions and normal recipient; no network or messages.`);
