export const categories = [
  { slug: 'business-news', label: 'Business News', short: 'Business' },
  { slug: 'interviews-appointments', label: 'Interviews & Appointments', short: 'Appointments' },
  { slug: 'money', label: 'Money', short: 'Money' },
  { slug: 'technology', label: 'Technology', short: 'Technology' },
  { slug: 'travel-tourism', label: 'Travel & Tourism', short: 'Travel' },
  { slug: 'luxury-living', label: 'Luxury Living', short: 'Living' }
];

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

export const demoArticles = [
  {
    id: 'bl-1',
    slug: 'finance-assets-surge',
    title: 'Finance Company Assets Surge 41% to Rs. 3.2 Trillion in Benchmark Growth Cycle',
    headline: 'Finance Company Assets Surge 41% to Rs. 3.2 Trillion in Benchmark Growth Cycle',
    category: 'Money',
    categorySlug: 'money',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-08-11T09:00:00.000Z',
    excerpt: 'Sri Lanka’s non-bank financial institution sector recorded an unprecedented expansion in balance sheet strength, with total aggregate assets reaching Rs. 3.2 trillion.',
    summary: 'Sri Lanka’s non-bank financial institution sector recorded an unprecedented expansion in balance sheet strength, with total aggregate assets reaching Rs. 3.2 trillion.',
    image: localImages[0],
    isTop: true,
    topRank: 1,
    body: [
      'Sri Lanka’s non-bank financial institution sector recorded an unprecedented expansion in balance sheet strength over the recent reporting period, with total aggregate assets reaching Rs. 3.2 trillion. The remarkable 41% year-on-year surge reflects renewed investor confidence, aggressive digital adoption, and expanding credit demand across small and medium enterprises.',
      'According to the latest monetary and credit aggregates, licensed finance companies witnessed solid portfolio diversification, driven by strong growth in gold-backed lending, leasing solutions for commercial transport, and working capital facilities for regional agri-businesses. Asset quality metrics also showed measurable improvement as non-performing loan ratios stabilized following disciplined underwriting standards.',
      'Industry leaders highlighted that technological modernization and consolidated capital buffers have positioned Sri Lankan financial institutions to capture emerging regional opportunities. Capital adequacy ratios across tier-one institutions remained well above statutory minimums, underscoring resilient balance sheet fundamentals.',
      'Market analysts project sustained growth momentum through the second half of the year, bolstered by macroeconomic stability, manageable borrowing costs, and rising business investment in domestic manufacturing and export value chains.'
    ]
  },
  {
    id: 'bl-2',
    slug: 'national-ai-institute',
    title: 'Establishment of National AI Institute to Drive Sri Lanka’s Digital Competitiveness',
    headline: 'Establishment of National AI Institute to Drive Sri Lanka’s Digital Competitiveness',
    category: 'Technology',
    categorySlug: 'technology',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-08-10T10:30:00.000Z',
    excerpt: 'A landmark initiative backed by top telecommunication and technology leaders is setting the stage for Sri Lanka’s first dedicated National Artificial Intelligence Institute.',
    summary: 'A landmark initiative backed by top telecommunication and technology leaders is setting the stage for Sri Lanka’s first dedicated National Artificial Intelligence Institute.',
    image: localImages[1],
    isTop: true,
    topRank: 2,
    body: [
      'Sri Lanka has accelerated its national digital transformation roadmap with the formal announcement of the National Artificial Intelligence Institute. The flagship initiative unites enterprise technology partners, universities, and policy makers to position the island as a high-value regional center for AI engineering, research, and applied computing.',
      'The institute will focus on developing enterprise AI applications across critical economic sectors, including financial services, logistics, smart agriculture, and healthcare. Special emphasis will be placed on nurturing local research talent, incubating high-growth deep-tech startups, and establishing governance frameworks for ethical and responsible AI adoption.',
      'Corporate executives spearheading the ecosystem emphasized that establishing high-tier research infrastructure will attract global engineering projects and stem brain drain by providing world-class career pathways for Sri Lankan software engineers and data scientists.',
      'The national roadmap envisions training over 10,000 specialists in machine learning and data engineering within the next three years, ensuring the nation’s workforce remains at the forefront of global technological innovation.'
    ]
  },
  {
    id: 'bl-3',
    slug: 'port-city-investment-outlook',
    title: 'Colombo Port City Attracts Multi-Million Dollar Capital Inflows in High-Yield Commercial Hub',
    headline: 'Colombo Port City Attracts Multi-Million Dollar Capital Inflows in High-Yield Commercial Hub',
    category: 'Business News',
    categorySlug: 'business-news',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-08-09T08:15:00.000Z',
    excerpt: 'Fresh investment outlook reports indicate accelerating international capital commitments towards Colombo Port City’s premier commercial and hospitality towers.',
    summary: 'Fresh investment outlook reports indicate accelerating international capital commitments towards Colombo Port City’s premier commercial and hospitality towers.',
    image: localImages[6],
    isTop: true,
    topRank: 3,
    body: [
      'International investors and multinational corporate headquarters are accelerating capital deployments into Colombo Port City as favorable regulatory incentives and world-class infrastructure redefine South Asia’s commercial real estate landscape.',
      'With duty concessions, specialized dispute resolution mechanisms, and modern green building certifications, several landmark commercial developments have broken ground. Key sectors driving absorption include offshore financial services, maritime management, regional logistics consultancy, and premier hospitality.',
      'Real estate analysts point to strong capital appreciation and attractive rental yields as primary catalysts for high-net-worth investors and family offices looking to diversify portfolios in an emerging Indian Ocean hub.',
      'The completion of key arterial transport connections and direct access expressways is anticipated to integrate the district seamlessly with greater Colombo, reinforcing the capital’s standing as an international business destination.'
    ]
  },
  {
    id: 'bl-4',
    slug: 'export-sector-momentum',
    title: 'Sri Lankan Export Sector Expands Into High-Value Global Markets with Double-Digit Growth',
    headline: 'Sri Lankan Export Sector Expands Into High-Value Global Markets with Double-Digit Growth',
    category: 'Business News',
    categorySlug: 'business-news',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-08-08T11:00:00.000Z',
    excerpt: 'Local exporters in value-added tea, precision apparel, electronics, and specialty rubber products have unlocked lucrative new contracts across North America, Europe, and East Asia.',
    summary: 'Local exporters in value-added tea, precision apparel, electronics, and specialty rubber products have unlocked lucrative new contracts across North America, Europe, and East Asia.',
    image: localImages[7],
    isTop: true,
    topRank: 4,
    body: [
      'Sri Lanka’s export sector is experiencing robust trade momentum as domestic manufacturers pivot towards premium, value-added products that command resilient pricing power in demanding overseas markets.',
      'From ethically sourced specialty teas and wellness botanicals to advanced technical apparel and automotive sensor components, Sri Lankan companies are leveraging sustainability credentials, carbon-neutral manufacturing, and agile supply chain solutions to win multinational contracts.',
      'Trade delegations and bilateral commercial agreements signed over the past quarters have significantly reduced non-tariff barriers, creating competitive entry points in fast-growing ASEAN and Middle Eastern economies.',
      'Industry leaders note that continued investments in automated production facilities and digital quality assurance will enable Sri Lankan enterprises to scale export revenue sustainably over the medium term.'
    ]
  },
  {
    id: 'bl-5',
    slug: 'seylan-profit-growth',
    title: 'Seylan Bank Reports 16.3% Profit Growth in June Quarter on Strong Core Banking Metrics',
    headline: 'Seylan Bank Reports 16.3% Profit Growth in June Quarter on Strong Core Banking Metrics',
    category: 'Money',
    categorySlug: 'money',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-08-01T07:45:00.000Z',
    excerpt: 'Strong net interest income, prudent cost management, and expanded digital transactions propelled Seylan Bank to a 16.3% rise in quarterly post-tax earnings.',
    summary: 'Strong net interest income, prudent cost management, and expanded digital transactions propelled Seylan Bank to a 16.3% rise in quarterly post-tax earnings.',
    image: localImages[3],
    isTop: true,
    topRank: 5,
    body: [
      'Seylan Bank delivered an impressive financial performance for the quarter ended June, posting a 16.3% year-on-year increase in profit after tax. The strong showing was underpinned by sustained expansion in net interest income, disciplined asset-liability management, and a pronounced surge in digital banking volumes.',
      'The bank’s total asset base continued its upward trajectory, bolstered by a steady expansion in retail deposits and low-cost current and savings accounts (CASA). Prudent provisioning policies and systematic risk assessments helped maintain solid impairment coverage across diverse portfolio segments.',
      'Strategic investments in digital branch operations and self-service banking ecosystems yielded notable operational efficiencies, lowering cost-to-income ratios while improving customer satisfaction benchmarks.',
      'The leadership reaffirmed its commitment to financing viable commercial ventures, supporting female entrepreneurship, and expanding international trade financing solutions for Sri Lankan businesses.'
    ]
  },
  {
    id: 'bl-6',
    slug: 'waterfront-residences-port-city',
    title: 'Prime Melwa Unveils Luxury Waterfront Residences at Colombo Port City to Global Acclaim',
    headline: 'Prime Melwa Unveils Luxury Waterfront Residences at Colombo Port City to Global Acclaim',
    category: 'Luxury Living',
    categorySlug: 'luxury-living',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-05-22T14:20:00.000Z',
    excerpt: 'A visionary ultra-luxury residential masterplan combining oceanfront elegance, private marina access, and sustainable architecture has set a new benchmark in Colombo.',
    summary: 'A visionary ultra-luxury residential masterplan combining oceanfront elegance, private marina access, and sustainable architecture has set a new benchmark in Colombo.',
    image: localImages[4],
    isTop: true,
    topRank: 6,
    body: [
      'Redefining premium coastal living, Prime Melwa has officially unveiled its luxury waterfront residential towers situated in the heart of Colombo Port City. The development offers discerning buyers uninterrupted Indian Ocean vistas, state-of-the-art wellness centers, and private yacht docking facilities.',
      'Architecturally designed to integrate natural cross-ventilation, expansive private balconies, and solar-integrated smart facade systems, the residences represent the pinnacle of climate-responsive luxury living in the region.',
      'Interest from international expatriates and high-net-worth investors was immediate, with initial booking phases recording substantial oversubscription. The properties benefit from specialized freehold land title regulations applicable within the designated Special Economic Zone.',
      'The milestone development underscores Colombo’s rapid emergence as a prime destination for luxury lifestyle real estate alongside global capitals like Dubai and Singapore.'
    ]
  },
  {
    id: 'bl-7',
    slug: 'tourist-arrivals-early-august',
    title: 'High-Yield Tourism Strategy Gathers Steam as Sri Lanka Welcomes Discerning International Travelers',
    headline: 'High-Yield Tourism Strategy Gathers Steam as Sri Lanka Welcomes Discerning International Travelers',
    category: 'Travel & Tourism',
    categorySlug: 'travel-tourism',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-08-12T12:00:00.000Z',
    excerpt: 'Sri Lanka’s tourism ecosystem is shifting emphasis towards high-spending experiential travelers, luxury wellness retreats, and eco-conservation safaris.',
    summary: 'Sri Lanka’s tourism ecosystem is shifting emphasis towards high-spending experiential travelers, luxury wellness retreats, and eco-conservation safaris.',
    image: localImages[2],
    isTop: true,
    topRank: 7,
    body: [
      'Sri Lanka’s hospitality and tourism industry is executing a strategic pivot toward premium experiential travelers, focusing on boutique eco-resorts, holistic Ayurveda wellness sanctuaries, and heritage cultural expeditions that maximize per-visitor economic yields.',
      'While arrival numbers moderated slightly in the initial days of August due to seasonal monsoon patterns in select coastal belts, average daily spend and length of stay among luxury segment guests reached multi-year highs. The central highlands, cultural triangle, and southern wellness retreats reported near-full occupancy.',
      'New direct airline routes from key European and Middle Eastern aviation hubs have facilitated seamless travel for affluent travelers seeking authentic, low-density nature and wildlife experiences.',
      'Hospitality operators are investing heavily in farm-to-table culinary programs, carbon-negative operations, and community heritage partnerships, cementing Sri Lanka’s global reputation as a premier destination for conscious luxury.'
    ]
  },
  {
    id: 'bl-8',
    slug: 'core-banking-upgrade',
    title: 'Bank of Ceylon Commits $10 Million Core Banking Modernization to Power Next-Gen Services',
    headline: 'Bank of Ceylon Commits $10 Million Core Banking Modernization to Power Next-Gen Services',
    category: 'Money',
    categorySlug: 'money',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-07-22T08:30:00.000Z',
    excerpt: 'The nation’s banking giant has embarked on an ambitious $10 million core architecture overhaul to deliver micro-services, real-time analytics, and open banking integrations.',
    summary: 'The nation’s banking giant has embarked on an ambitious $10 million core architecture overhaul to deliver micro-services, real-time analytics, and open banking integrations.',
    image: localImages[9],
    isTop: true,
    topRank: 8,
    body: [
      'In a transformative step toward enterprise digital agility, Bank of Ceylon has signed a multi-year $10 million agreement to upgrade and modernize its mission-critical core banking infrastructure. The cutting-edge system architecture will enable real-time payment processing, predictive risk scoring, and seamless API integrations.',
      'The modern platform is designed to process millions of transactions per second with enterprise-grade fault tolerance, providing unmatched reliability for retail consumers, corporate conglomerates, and cross-border remittance corridors.',
      'Through open banking capabilities, the platform will allow fintech innovators to partner with the bank, rapidly deploying customized micro-lending products, digital wealth management tools, and automated treasury services.',
      'The modernization initiative stands as one of the largest technology infrastructure investments in Sri Lanka’s financial history, laying the foundation for a fully digital economy.'
    ]
  },
  {
    id: 'bl-9',
    slug: 'range-rover-colombo-concept',
    title: 'Range Rover Debuts Exclusive Luxury Retail Boutique and Bespoke Studio in Colombo',
    headline: 'Range Rover Debuts Exclusive Luxury Retail Boutique and Bespoke Studio in Colombo',
    category: 'Luxury Living',
    categorySlug: 'luxury-living',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-05-08T15:10:00.000Z',
    excerpt: 'Automotive luxury reached new heights with the opening of an experiential SV Bespoke studio offering personalized vehicle tailoring and VIP private viewing lounges.',
    summary: 'Automotive luxury reached new heights with the opening of an experiential SV Bespoke studio offering personalized vehicle tailoring and VIP private viewing lounges.',
    image: localImages[8],
    isTop: true,
    topRank: 9,
    body: [
      'Range Rover has elevated automotive luxury in South Asia with the grand opening of its brand-new experiential retail concept in Colombo. The bespoke showroom is crafted to offer an intimate, consultative environment where discerning patrons can customize bespoke vehicles down to hand-stitched leather patterns and rare wood veneers.',
      'The facility incorporates private consultation lounges, high-definition digital rendering suites, and a dedicated handover sanctuary designed to deliver an unforgettable customer journey.',
      'Executive spokespersons noted that rising demand for electrified luxury powertrains and ultra-exclusive bespoke trims across Sri Lanka prompted the establishment of this flagship destination.',
      'The boutique exemplifies how luxury brands are tailoring their retail presence to provide holistic lifestyle experiences that match the expectations of elite global collectors.'
    ]
  },
  {
    id: 'bl-10',
    slug: 'new-digital-economy-secretary',
    title: 'Leadership Transition: Digital Economy Ministry Appoints New Secretary to Spearhead National Reforms',
    headline: 'Leadership Transition: Digital Economy Ministry Appoints New Secretary to Spearhead National Reforms',
    category: 'Interviews & Appointments',
    categorySlug: 'interviews-appointments',
    source: 'Business Leaders Desk',
    sourceUrl: '#',
    publishedAt: '2026-02-13T10:00:00.000Z',
    excerpt: 'Seasoned public policy and technology leader Waruna Sri Dhanapala assumes duties as Secretary to the Ministry of Digital Economy to accelerate national digital identity and cloud policy.',
    summary: 'Seasoned public policy and technology leader Waruna Sri Dhanapala assumes duties as Secretary to the Ministry of Digital Economy to accelerate national digital identity and cloud policy.',
    image: localImages[5],
    isTop: true,
    topRank: 10,
    body: [
      'The Ministry of Digital Economy has marked a crucial leadership milestone with the official appointment of Waruna Sri Dhanapala as Secretary. With extensive experience across international governance forums and domestic digital infrastructure initiatives, the appointment signals an aggressive push toward institutional reform.',
      'Key priorities outlined under the new leadership mandate include the full-scale rollout of the National Digital ID framework, cloud-first government architectures, comprehensive cybersecurity standards, and legal frameworks to foster cross-border digital trade.',
      'Industry stakeholders across the IT/BPM sector warmly welcomed the appointment, citing the necessity for coordinated execution between state agencies, regulatory authorities, and private innovation hubs.',
      'The Ministry plans to publish its updated five-year digital roadmap within the coming quarter, setting concrete metrics for digital public services, SME digitization, and technological export growth.'
    ]
  }
];

export const categoryBySlug = (slug) => categories.find((item) => item.slug === slug);
