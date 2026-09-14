import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import * as store from './store.js'
import './styles.css'

store.initStore().then(() => {
  if (store.hasCloud && typeof store.initCloud === 'function') {
    store.initCloud()
  }
  createRoot(document.getElementById('root')).render(<App />)
})