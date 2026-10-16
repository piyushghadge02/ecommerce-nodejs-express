import { createRouter, createWebHistory } from 'vue-router'

import Storefront from '../views/Storefront.vue'
import Checkout from '../views/Checkout.vue'
import AdminDashboard from '../views/AdminDashboard.vue'
import OrderDetails from '../views/OrderDetails.vue'
import CatalogAdmin from '../views/CatalogAdmin.vue'

const routes = [
  { path: '/', name: 'storefront', component: Storefront, meta: { title: 'Storefront' } },
  { path: '/checkout', name: 'checkout', component: Checkout, meta: { title: 'Checkout' } },
  { path: '/admin', name: 'admin-dashboard', component: AdminDashboard, meta: { title: 'Order Search Dashboard' } },
  {
    path: '/admin/orders/:id',
    name: 'order-details',
    component: OrderDetails,
    props: true,
    meta: { title: 'Order Details' },
  },
  { path: '/admin/catalog', name: 'catalog-admin', component: CatalogAdmin, meta: { title: 'Catalog Administration' } },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 }
  },
})

router.afterEach((to) => {
  document.title = `${to.meta.title ?? 'App'} — E-Commerce Hub`
})

export default router
