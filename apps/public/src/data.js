export const categories = [
  { slug: 'business-news', label: 'Business News', short: 'Business' },
  { slug: 'interviews-appointments', label: 'Interviews & Appointments', short: 'Appointments' },
  { slug: 'money', label: 'Money', short: 'Money' },
  { slug: 'technology', label: 'Technology', short: 'Technology' },
  { slug: 'travel-tourism', label: 'Travel & Tourism', short: 'Travel' },
  { slug: 'luxury-living', label: 'Luxury Living', short: 'Living' }
];

// =========================================================================
// CLIENT DEMO IMAGES (FOR VERCEL STATIC HOSTING)
// Reliable, high-resolution Unsplash image URLs for public demo website.
// -------------------------------------------------------------------------
// TO REVERT TO LOCAL ASSET PATHS:
// Uncomment original array below and comment out Unsplash URLs.
// =========================================================================
const localImages = [
  'https://images.unsplash.com/photo-1590283603385-17ffb3a7f29f?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1554469384-e58fac16e23a?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1556761175-5973dc0f32e7?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80',
  'https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1200&q=80'
];

const seed = [
  ['finance-assets-surge', 'Finance company assets surge 41% to Rs. 3.2 trillion', 'Money', 'money', 'Daily FT', '2026-08-11', 'Sri Lanka’s finance company sector recorded a sharp rise in assets, reaching Rs. 3.2 trillion, according to the latest sector update.'],
  ['national-ai-institute', 'SLT-Mobitel backs establishment of National AI Institute', 'Technology', 'technology', 'Daily Mirror', '2026-08-10', 'The national telecommunications provider has announced its support for a proposed institute focused on artificial intelligence.'],
  ['tourist-arrivals-early-august', 'Tourist arrivals ease 8% in early August', 'Travel & Tourism', 'travel-tourism', 'Daily Mirror', '2026-08-12', 'Visitor arrivals declined during the opening days of August, placing renewed attention on the sector’s near-term momentum.'],
  ['seylan-profit-growth', 'Seylan Bank reports 16.3% profit growth in June quarter', 'Money', 'money', 'Sri Lanka Biz', '2026-08-01', 'Seylan Bank reported year-on-year profit growth of 16.3% for the quarter ending in June.'],
  ['waterfront-residences-port-city', 'Prime Melwa launches luxury waterfront residences at Colombo Port City', 'Luxury Living', 'luxury-living', 'Daily Mirror', '2026-05-22', 'A new residential development has been introduced at Colombo Port City with a focus on waterfront living.'],
  ['new-digital-economy-secretary', 'Waruna Sri Dhanapala appointed Secretary to Ministry of Digital Economy', 'Interviews & Appointments', 'interviews-appointments', 'Daily Mirror', '2026-02-13', 'Waruna Sri Dhanapala has been appointed Secretary to the Ministry of Digital Economy.'],
  ['twenty-new-tourist-zones', 'Sri Lanka plans to add 20 new tourist zones', 'Travel & Tourism', 'travel-tourism', 'Sri Lanka Mirror', '2026-06-19', 'Plans have been outlined to introduce 20 additional tourism zones across Sri Lanka.'],
  ['range-rover-colombo-concept', 'Range Rover unveils experiential luxury retail concept in Colombo', 'Luxury Living', 'luxury-living', 'Daily Mirror', '2026-05-08', 'Range Rover has introduced an experiential retail concept for customers in Colombo.'],
  ['ai-amplified-launch', 'Media launch of “AI Amplified” initiative held', 'Technology', 'technology', 'Daily Mirror', '2026-08-07', 'The “AI Amplified” initiative was introduced to the media at a recent launch event.'],
  ['core-banking-upgrade', 'Bank of Ceylon invests $10 million to upgrade core banking system', 'Money', 'money', 'Sri Lanka Biz', '2026-07-22', 'Bank of Ceylon is investing $10 million in an upgrade of its core banking technology.'],
  ['air-vice-marshal-dgca', 'Air Vice Marshal appointed as new Director General of Civil Aviation', 'Interviews & Appointments', 'interviews-appointments', 'Civil Aviation Authority', '2026-03-30', 'The Civil Aviation Authority of Sri Lanka announced the appointment of a new Director General of Civil Aviation.'],
  ['srilankan-airlines-chairman', 'SriLankan Airlines confirms new chairman', 'Interviews & Appointments', 'interviews-appointments', 'The Morning', '2026-06-12', 'SriLankan Airlines has confirmed the appointment of its new chairman.'],
  ['navy-commander-meets-defence-secretary', 'New Navy Commander meets Defence Secretary', 'Interviews & Appointments', 'interviews-appointments', 'The Morning', '2026-07-02', 'The newly appointed Navy Commander met with the Defence Secretary in an official engagement.'],
  ['army-deputy-chief-assumes-duties', 'New Deputy Chief of Staff assumes duties at Sri Lanka Army', 'Interviews & Appointments', 'interviews-appointments', 'Sri Lanka Army', '2026-04-07', 'The Sri Lanka Army’s new Deputy Chief of Staff formally assumed duties.'],
  ['lb-finance-profit', 'LB Finance posts pre-tax profit exceeding Rs. 25 billion', 'Money', 'money', 'Daily Mirror', '2026-06-08', 'LB Finance reported pre-tax profit above Rs. 25 billion for the period under review.'],
  ['vehicle-import-ltv-cap', 'Central Bank maintains LTV cap on vehicle import loans', 'Money', 'money', 'Sri Lanka Biz', '2026-07-23', 'The Central Bank has retained the loan-to-value cap applying to credit for vehicle imports.'],
  ['gates-foundation-digital-talks', 'Sri Lanka discusses digital transformation with Gates Foundation', 'Technology', 'technology', 'The Morning', '2026-05-21', 'Sri Lankan representatives held discussions with the Gates Foundation on the country’s digital transformation agenda.'],
  ['wiin-trace-city', 'WIIN Institute of Technology inaugurated at TRACE Expert City', 'Technology', 'technology', 'The Island', '2026-08-01', 'The WIIN Institute of Technology has been inaugurated at TRACE Expert City.'],
  ['sliot-robogames-finals', 'SLT-Mobitel hosts SLIoT Challenge and IESL RoboGames finals', 'Technology', 'technology', 'Daily News', '2026-06-25', 'SLT-Mobitel hosted the finals of the SLIoT Challenge and IESL RoboGames.'],
  ['zero-emission-tourist-zones', 'Sri Lanka aims to develop zero-emission tourist zones', 'Travel & Tourism', 'travel-tourism', 'Xinhua', '2026-06-05', 'Sri Lanka has outlined an ambition to develop tourism zones designed around zero-emission principles.'],
  ['buddhas-footsteps-circuit', '“Buddha’s Footsteps” tour circuit launched ahead of direct flights', 'Travel & Tourism', 'travel-tourism', 'news.lk', '2026-07-17', 'A Buddhist tourism circuit named “Buddha’s Footsteps” has been launched ahead of planned direct flight connections.'],
  ['delft-sustainable-tourism', 'Government initiates development of Delft Island as sustainable destination', 'Travel & Tourism', 'travel-tourism', 'Daily Mirror', '2026-08-04', 'A government initiative will focus on developing Delft Island as a sustainable tourism destination.'],
  ['malinga-odiliya-ambassador', 'Lasith Malinga appointed brand ambassador for Odiliya Homes', 'Luxury Living', 'luxury-living', 'Daily News', '2026-07-30', 'Former Sri Lankan cricketer Lasith Malinga has been appointed as a brand ambassador for Odiliya Homes & Residencies.'],
  ['stanley-lifestyles-singer', 'Stanley Lifestyles enters Sri Lanka through partnership with Singer', 'Luxury Living', 'luxury-living', 'Sunday Observer', '2026-07-04', 'Stanley Lifestyles has entered the Sri Lankan market through a strategic partnership with Singer.'],
  ['thotalagala-worlds-50', 'Thotalagala listed among “World’s 50 Best Discovery”', 'Luxury Living', 'luxury-living', 'Daily Mirror', '2026-07-24', 'Thotalagala has been included in the “World’s 50 Best Discovery” selection.'],
  ['port-city-investment-outlook', 'New investment outlook places Colombo’s commercial momentum in focus', 'Business News', 'business-news', 'EconomyNext', '2026-08-09', 'A fresh investment outlook examines business confidence, capital flows and the next phase of commercial activity in Colombo.'],
  ['export-sector-momentum', 'Export sector builds momentum as firms look to new markets', 'Business News', 'business-news', 'Daily FT', '2026-08-08', 'Sri Lankan exporters are exploring new markets as the sector looks to sustain its recent momentum.'],
  ['enterprise-digital-payments', 'Enterprises accelerate shift towards secure digital payments', 'Business News', 'business-news', 'Daily Mirror', '2026-08-06', 'Businesses are expanding their use of secure digital payment channels across day-to-day operations.']
];

const sourceUrls = {
  'Daily FT': 'https://www.ft.lk', 'Daily Mirror': 'https://www.dailymirror.lk',
  'Sri Lanka Biz': 'https://srilankabiz.lk', 'Sri Lanka Mirror': 'https://srilankamirror.com',
  'Civil Aviation Authority': 'https://www.caa.lk', 'The Morning': 'https://www.themorning.lk',
  'Sri Lanka Army': 'https://www.army.lk', 'The Island': 'https://island.lk',
  'Daily News': 'https://dailynews.lk', Xinhua: 'https://english.news.cn',
  'news.lk': 'https://www.news.lk', 'Sunday Observer': 'https://www.sundayobserver.lk',
  EconomyNext: 'https://economynext.com'
};

export const demoArticles = seed.map(([slug, title, category, categorySlug, source, publishedAt, excerpt], index) => ({
  id: `demo-${index + 1}`,
  slug,
  title,
  headline: title,
  category,
  categorySlug,
  source,
  sourceUrl: sourceUrls[source] || '#',
  publishedAt,
  excerpt,
  summary: excerpt,
  image: localImages[index % localImages.length],
  isTop: index < 10,
  topRank: index < 10 ? index + 1 : null,
  body: [
    excerpt,
    'This preview is part of the editorial demonstration feed. The full approved report will appear here after review in the publishing dashboard.',
    'Readers can follow the original publisher link for the source report and additional context.'
  ]
}));

export const categoryBySlug = (slug) => categories.find((item) => item.slug === slug);
