import React, { useState, useEffect } from 'react';

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const getLink = (p) => `https://www.firstcry.com/hot-wheels/${slugify(p.PNm)}/${p.PId}/product-detail`;

export default function App() {
  const [data, setData] = useState({ products: [], inStock: [], lastScanned: null, scanning: true });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStock, setFilterStock] = useState('instock'); // 'instock', 'all'
  const [sortBy, setSortBy] = useState('newest'); // 'newest', 'price-high-low', 'price-low-high'

  const fetchData = async (isManual = false) => {
    if (isManual) setLoading(true);
    try {
      const res = await fetch('https://hotwheelssniperbackend.onrender.com/api/status');
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error('Failed to connect to backend', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(true);
    const interval = setInterval(() => fetchData(false), 30000);
    return () => clearInterval(interval);
  }, []);

  const triggerScan = async () => {
    setLoading(true);
    try {
      const res = await fetch('http://localhost:5000/api/scan', { method: 'POST' });
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  // Base list filter
  let list = filterStock === 'instock' ? data.inStock : data.products;

  // Search filter
  list = list.filter(p => p.PNm.toLowerCase().includes(search.toLowerCase()));

  // Sorting
  const sortedProducts = [...list].sort((a, b) => {
    if (sortBy === 'price-high-low') {
      return Number(b.discprice || b.mrp || 0) - Number(a.discprice || a.mrp || 0);
    }
    if (sortBy === 'price-low-high') {
      return Number(a.discprice || a.mrp || 0) - Number(b.discprice || b.mrp || 0);
    }
    // Default: Newest arrivals / ID order
    return Number(b.PId) - Number(a.PId);
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-red-600 selection:text-white">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center space-x-3">
          <span className="text-3xl">🏎️</span>
          <div>
            <h1 className="text-xl font-bold tracking-wider uppercase bg-gradient-to-r from-red-500 to-amber-500 bg-clip-text text-transparent">
              Hot Wheels Sniper
            </h1>
            <p className="text-xs text-slate-400">FirstCry Live New Arrivals Tracker</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <div className="text-xs text-slate-400">Last Scanned</div>
            <div className="text-sm font-medium text-emerald-400">{data.lastScanned || 'Never'}</div>
          </div>
          <button
            onClick={triggerScan}
            disabled={loading}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 active:scale-95 transition rounded-lg text-sm font-semibold shadow-lg shadow-red-600/30 disabled:opacity-50 flex items-center gap-2">
            {loading ? <span className="animate-spin">⏳</span> : '🔄'} Scan Now
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="text-slate-400 text-sm">Total Scanned</div>
            <div className="text-3xl font-extrabold mt-1 text-white">{data.products.length}</div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm">
            <div className="text-slate-400 text-sm">In Stock Right Now</div>
            <div className="text-3xl font-extrabold mt-1 text-emerald-400">{data.inStock.length}</div>
          </div>
        </div>

        {/* Controls: Search, Stock Filter & Sort */}
        <div className="flex flex-col lg:flex-row justify-between items-center gap-4 mb-6">
          <input
            type="text"
            placeholder="Search casting name (e.g. Skyline, Porsche)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full lg:w-96 px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl focus:outline-none focus:border-red-500 text-sm"
          />

          <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto">
            <div className="flex gap-2">
              <button
                onClick={() => setFilterStock('instock')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${filterStock === 'instock' ? 'bg-emerald-600 text-white' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'}`}>
                In Stock ({data.inStock.length})
              </button>
              <button
                onClick={() => setFilterStock('all')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition ${filterStock === 'all' ? 'bg-slate-700 text-white' : 'bg-slate-900 border border-slate-800 text-slate-400 hover:text-white'}`}>
                All Scanned ({data.products.length})
              </button>
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-sm text-slate-300 focus:outline-none focus:border-red-500">
              <option value="newest">Sort: Newest First</option>
              <option value="price-high-low">Price: High to Low</option>
              <option value="price-low-high">Price: Low to High</option>
            </select>
          </div>
        </div>

        {/* Loading Skeleton */}
        {loading && data.products.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="bg-slate-900 border border-slate-800 rounded-xl p-4 h-72 animate-pulse flex flex-col justify-between">
                <div className="bg-slate-800 h-40 rounded-lg mb-4"></div>
                <div className="space-y-2">
                  <div className="bg-slate-800 h-4 rounded w-3/4"></div>
                  <div className="bg-slate-800 h-4 rounded w-1/2"></div>
                </div>
              </div>
            ))}
          </div>
        ) : sortedProducts.length === 0 ? (
          <div className="text-center py-20 text-slate-500">
            <p className="text-lg">No Hot Wheels found matching your criteria.</p>
          </div>
        ) : (
          /* Product Grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {sortedProducts.map((p) => {
              console.log(p.PId)
              const inStock = Number(p.CrntStock) > 0;
              return (
                <div key={p.PId} className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-4 flex flex-col justify-between transition group shadow-md">
                  <div>
                    {/* Product Image Preview */}

                    <div className="w-full h-44 bg-slate-950 rounded-lg mb-3 overflow-hidden flex items-center justify-center border border-slate-800 relative">
                      <img
                        src={`https://cdn.fcglcdn.com/brainbees/images/products/800x700/${p.PId}a.webp`}
                        alt={p.PNm}
                        className="object-contain h-full w-full group-hover:scale-105 transition duration-300"
                        loading="lazy"
                      />
                      <span className={`absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full font-semibold ${inStock ? 'bg-emerald-500/90 text-white' : 'bg-rose-500/90 text-white'}`}>
                        {inStock ? `Stock: ${p.CrntStock}` : 'Out of Stock'}
                      </span>
                    </div>

                    <h3 className="font-semibold text-slate-200 group-hover:text-red-400 transition line-clamp-2 text-sm mb-2">
                      {p.PNm}
                    </h3>
                  </div>

                  <div>
                    <div className="flex items-baseline justify-between mb-4">
                      <span className="text-lg font-bold text-white">₹{p.discprice}</span>
                      {p.mrp && p.mrp > p.discprice && (
                        <span className="text-xs text-slate-500 line-through">₹{p.mrp}</span>
                      )}
                    </div>
                    <a
                      href={getLink(p)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full text-center py-2 bg-red-600/10 hover:bg-red-600 border border-red-500/30 hover:border-red-600 text-red-400 hover:text-white rounded-lg text-sm font-semibold transition">
                      Snatch on FirstCry ↗
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}