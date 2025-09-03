import React from 'react'
import { Outlet } from 'react-router-dom'

const Layout = () => {
  return (
    <div>
      <h1>Layout</h1>
      <Outlet/>  {/* to mount child routes */}
    </div>
  )
}

export default Layout
