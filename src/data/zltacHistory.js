// Hall of Fame, per-year placings, legends, and dynasties moved to Supabase
// (tables zltac_hall_of_fame, zltac_event_history, zltac_event_placings,
// zltac_legends, zltac_dynasties). See migration
// supabase/migrations/20260519000000_zltac_history_unification.sql.
//
// hosting and formatEvolution remain here — they're derived/static reference
// data with no admin-editing flow yet.
export const zltacHistory = {
  hosting: [
    { region: "QLD", country: "AU", years: [2001, 2005, 2009, 2016, 2019, 2025], count: 6 },
    { region: "VIC", country: "AU", years: [1999, 2000, 2007, 2011, 2015, 2022], count: 6 },
    { region: "ACT", country: "AU", years: [2002, 2013, 2027], count: 3 },
    { region: "NSW", country: "AU", years: [2006, 2018, 2024], count: 3 },
    { region: "TAS", country: "AU", years: [2003, 2012, 2023], count: 3 },
    { region: "NT", country: "AU", years: [2010, 2020], count: 2 },
    { region: "NZ", country: "NZ", years: [2014, 2026], count: 2 },
    { region: "WA", country: "AU", years: [2004, 2008], count: 2 },
    { region: "SA", country: "AU", years: [2017], count: 1 },
  ],

  formatEvolution: [
    { year: 1999, added: ["Teams"], divisionCount: 1, era: "1999" },
    { year: 2000, added: ["Doubles", "Solos"], divisionCount: 3, era: "2000-2004" },
    { year: 2005, added: ["Triples", "Masters", "Womens"], divisionCount: 6, era: "2005-2011" },
    { year: 2012, added: ["LotR"], divisionCount: 7, era: "2012-2015" },
    { year: 2016, added: ["Juniors"], divisionCount: 8, era: "2016-present" },
  ],
}
