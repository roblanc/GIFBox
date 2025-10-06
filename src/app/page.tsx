'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import gifsData from '../../data/gifs.json';

interface Gif {
  id: number;
  title: string;
  category: string;
  file: string;
}

export default function Home() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');

  const categories = ['All', ...Array.from(new Set(gifsData.map((g) => g.category)))];

  const filteredGifs = gifsData.filter((gif) => {
    const categoryMatch = selectedCategory === 'All' || gif.category === selectedCategory;
    const searchMatch = gif.title.toLowerCase().includes(searchTerm.toLowerCase());
    return categoryMatch && searchMatch;
  });

  return (
    <main>
      <div className="container py-5">
        <header className="text-center mb-5">
          <h1 className="display-4">GIFBox</h1>
          <p className="lead text-muted">A clever, cheeky box of GIFs.</p>
        </header>

        {/* Search and Filter Controls */}
        <div className="row justify-content-center mb-4">
          <div className="col-md-6">
            <input
              type="text"
              className="form-control"
              placeholder="Search for a GIF..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </div>
        <div className="text-center mb-5">
          {categories.map((category) => (
            <button
              key={category}
              className={`btn ${selectedCategory === category ? 'btn-primary' : 'btn-outline-secondary'} m-1`}
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {/* GIF Grid */}
        <div className="row">
          {filteredGifs.length > 0 ? (
            filteredGifs.map((gif: Gif) => (
              <div key={gif.id} className="col-lg-3 col-md-4 col-sm-6 mb-4">
                <div className="card h-100 shadow-sm">
                  <div style={{ width: '100%', height: '200px', backgroundColor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Image
                      src={`/gifs/${gif.file}`}
                      alt={gif.title}
                      width={150}
                      height={150}
                      style={{ objectFit: 'contain' }}
                      unoptimized={true} // Necessary for GIFs in Next.js Image component
                      onError={(e) => {
                        // Fallback for missing images
                        const target = e.target as HTMLImageElement;
                        target.style.display = 'none';
                        const parent = target.parentElement;
                        if (parent) {
                            const text = document.createElement('span');
                            text.className = 'text-muted small';
                            text.innerText = 'Image not found';
                            parent.appendChild(text);
                        }
                      }}
                    />
                  </div>
                  <div className="card-body text-center">
                    <h5 className="card-title">{gif.title}</h5>
                  </div>
                  <div className="card-footer text-center">
                    <a href={`/gifs/${gif.file}`} download className="btn btn-success w-100">
                      Download
                    </a>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="col text-center">
              <p>No GIFs found. Try adjusting your search or filter.</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}