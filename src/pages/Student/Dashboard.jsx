import React, { useState, useEffect } from 'react';
import { Plus, Minus, ShoppingCart, Clock, CheckCircle, AlertCircle, Package, Star, Filter, Search, X, Utensils, Coffee, Crown } from 'lucide-react';
import Header from '../../components/Layout/Header';
import Toast from '../../components/Common/Toast';
import { useRealtimeSubscription } from '../../hooks/useRealtimeSubscription';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import Footer from '../../components/Common/Footer';

const StudentDashboard = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('menu');
  const [menuItems, setMenuItems] = useState([]);
  const [cartItems, setCartItems] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [addingToCart, setAddingToCart] = useState(new Set());
  const [placingOrder, setPlacingOrder] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [toasts, setToasts] = useState([]);

  // Real-time subscriptions
  useRealtimeSubscription({
    table: 'menu_items',
    onUpdate: (payload) => {
      console.log('Menu item updated:', payload);
      setMenuItems(prev => prev.map(item => 
        item.id === payload.new.id ? { ...item, ...payload.new } : item
      ));
    }
  });

  useRealtimeSubscription({
    table: 'cart_items',
    filter: `user_id=eq.${user?.id}`,
    onUpdate: (payload) => {
      console.log('Cart updated:', payload);
      fetchCartItems();
    },
    onInsert: (payload) => {
      console.log('Item added to cart:', payload);
      fetchCartItems();
    },
    onDelete: (payload) => {
      console.log('Item removed from cart:', payload);
      fetchCartItems();
    }
  });

  useRealtimeSubscription({
    table: 'orders',
    filter: `user_id=eq.${user?.id}`,
    onUpdate: (payload) => {
      console.log('Order updated:', payload);
      fetchOrders();
      if (payload.new.status === 'ready') {
        showToast('Your order is ready for pickup!', 'success');
      }
    },
    onInsert: (payload) => {
      console.log('New order placed:', payload);
      fetchOrders();
    }
  });

  const showToast = (message, type) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, message, type }]);
  };

  const removeToast = (id) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  };

  useEffect(() => {
    fetchMenuItems();
    fetchCartItems();
    fetchOrders();
  }, []);

  const fetchMenuItems = async () => {
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .gt('quantity_available', 0)
        .order('name');

      if (error) throw error;
      setMenuItems(data || []);
    } catch (error) {
      console.error('Error fetching menu items:', error);
      showToast('Failed to load menu items', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchCartItems = async () => {
    try {
      if (!user?.id) return;

      const { data, error } = await supabase
        .from('cart_items')
        .select(`
          *,
          menu_item:menu_items(*)
        `)
        .eq('user_id', user.id);

      if (error) throw error;
      setCartItems(data || []);
    } catch (error) {
      console.error('Error fetching cart items:', error);
    }
  };

  const fetchOrders = async () => {
    try {
      if (!user?.id) return;

      const { data: ordersData, error: ordersError } = await supabase
        .from('orders')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (ordersError) throw ordersError;

      if (!ordersData || ordersData.length === 0) {
        setOrders([]);
        return;
      }

      const orderIds = ordersData.map(order => order.id);
      const { data: orderItems, error: orderItemsError } = await supabase
        .from('order_items')
        .select(`
          *,
          menu_item:menu_items(*)
        `)
        .in('order_id', orderIds);

      if (orderItemsError) throw orderItemsError;

      const ordersWithItems = ordersData.map(order => ({
        ...order,
        order_items: orderItems?.filter(item => item.order_id === order.id) || []
      }));

      setOrders(ordersWithItems);
    } catch (error) {
      console.error('Error fetching orders:', error);
    }
  };

  const addToCart = async (menuItem) => {
    if (addingToCart.has(menuItem.id)) return;

    setAddingToCart(prev => new Set(prev).add(menuItem.id));

    try {
      const existingCartItem = cartItems.find(item => item.menu_item_id === menuItem.id);

      if (existingCartItem) {
        const { error } = await supabase
          .from('cart_items')
          .update({ quantity: existingCartItem.quantity + 1 })
          .eq('id', existingCartItem.id);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('cart_items')
          .insert({
            user_id: user.id,
            menu_item_id: menuItem.id,
            quantity: 1
          });

        if (error) throw error;
      }

      showToast(`${menuItem.name} added to cart!`, 'success');
      await fetchCartItems();
    } catch (error) {
      console.error('Error adding to cart:', error);
      showToast('Failed to add item to cart', 'error');
    } finally {
      setAddingToCart(prev => {
        const newSet = new Set(prev);
        newSet.delete(menuItem.id);
        return newSet;
      });
    }
  };

  const updateCartQuantity = async (cartItemId, newQuantity) => {
    try {
      if (newQuantity <= 0) {
        const { error } = await supabase
          .from('cart_items')
          .delete()
          .eq('id', cartItemId);

        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('cart_items')
          .update({ quantity: newQuantity })
          .eq('id', cartItemId);

        if (error) throw error;
      }

      await fetchCartItems();
    } catch (error) {
      console.error('Error updating cart:', error);
      showToast('Failed to update cart', 'error');
    }
  };

  const placeOrder = async () => {
    if (placingOrder || cartItems.length === 0) return;

    setPlacingOrder(true);

    try {
      const totalAmount = cartItems.reduce((sum, item) => 
        sum + (item.menu_item.price * item.quantity), 0
      );

      const { data: orderData, error: orderError } = await supabase
        .from('orders')
        .insert({
          user_id: user.id,
          total_amount: totalAmount,
          status: 'pending',
          payment_status: 'pending'
        })
        .select()
        .single();

      if (orderError) throw orderError;

      const orderItems = cartItems.map(item => ({
        order_id: orderData.id,
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        price: item.menu_item.price
      }));

      const { error: orderItemsError } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (orderItemsError) throw orderItemsError;

      // Update menu item quantities
      for (const item of cartItems) {
        const { error } = await supabase
          .from('menu_items')
          .update({ 
            quantity_available: item.menu_item.quantity_available - item.quantity 
          })
          .eq('id', item.menu_item_id);

        if (error) console.error('Error updating quantity:', error);
      }

      // Clear cart
      const { error: clearCartError } = await supabase
        .from('cart_items')
        .delete()
        .eq('user_id', user.id);

      if (clearCartError) throw clearCartError;

      showToast('Order placed successfully!', 'success');
      setIsCartOpen(false);
      await fetchCartItems();
      await fetchOrders();
      await fetchMenuItems();
    } catch (error) {
      console.error('Error placing order:', error);
      showToast('Failed to place order', 'error');
    } finally {
      setPlacingOrder(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'pending': return 'status-pending';
      case 'processing': return 'status-processing';
      case 'ready': return 'status-ready';
      case 'completed': return 'status-completed';
      case 'cancelled': return 'status-cancelled';
      default: return 'status-pending';
    }
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'pending': return <Clock className="w-4 h-4" />;
      case 'processing': return <Package className="w-4 h-4" />;
      case 'ready': return <CheckCircle className="w-4 h-4" />;
      case 'completed': return <CheckCircle className="w-4 h-4" />;
      case 'cancelled': return <AlertCircle className="w-4 h-4" />;
      default: return <Clock className="w-4 h-4" />;
    }
  };

  const filteredMenuItems = menuItems.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = ['all', ...new Set(menuItems.map(item => item.category))];
  const cartTotal = cartItems.reduce((sum, item) => sum + (item.menu_item.price * item.quantity), 0);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);

  if (loading) {
    return (
      <div className="min-h-screen modern-gradient flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 modern-spinner rounded-full animate-spin mx-auto mb-6"></div>
          <div className="flex items-center justify-center space-x-3">
            <Coffee className="w-6 h-6 text-red-500" />
            <span className="text-xl font-medium text-gray-200">Loading Menu...</span>
          </div>
          <p className="text-gray-400 text-sm mt-2">Preparing your dining experience</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen modern-gradient transition-colors duration-200 flex flex-col">
      <Header 
        title={`Welcome, ${user?.full_name?.split(' ')[0] || 'Student'}!`}
        showCart={true}
        cartCount={cartCount}
        onCartClick={() => setIsCartOpen(true)}
      />

      {/* Toast Notifications */}
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}

      <div className="w-full px-4 sm:px-6 lg:px-8 py-8 flex-1">
        {/* Tabs */}
        <div className="mb-6 sm:mb-8">
          <nav className="flex space-x-4 sm:space-x-8 overflow-x-auto pb-2">
            <button
              onClick={() => setActiveTab('menu')}
              className={`py-2 px-2 sm:px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors duration-200 ${
                activeTab === 'menu'
                  ? 'border-red-500 text-red-400'
                  : 'border-transparent text-gray-600 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:border-gray-400'
              }`}
            >
              Browse Menu
            </button>
            <button
              onClick={() => setActiveTab('orders')}
              className={`py-2 px-2 sm:px-1 border-b-2 font-medium text-sm whitespace-nowrap transition-colors duration-200 ${
                activeTab === 'orders'
                  ? 'border-red-500 text-red-400'
                  : 'border-transparent text-gray-600 dark:text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 hover:border-gray-400'
              }`}
            >
              My Orders
            </button>
          </nav>
        </div>

        {/* Menu Tab */}
        {activeTab === 'menu' && (
          <div className="space-y-6">
            {/* Search and Filter */}
            <div className="flex flex-col lg:flex-row gap-4">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-3 h-5 w-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search for delicious food..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 modern-input rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
              <div className="flex space-x-2 overflow-x-auto pb-2">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-4 py-2 rounded-lg font-medium text-sm whitespace-nowrap transition-all duration-200 ${
                      selectedCategory === category
                        ? 'modern-button text-white'
                        : 'glass-morphism text-gray-700 dark:text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    {category === 'all' ? 'All Items' : category.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </button>
                ))}
              </div>
            </div>

            {/* Menu Items Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {filteredMenuItems.map((item) => (
                <div key={item.id} className="glass-card rounded-xl overflow-hidden hover-lift">
                  <img
                    src={item.image_url}
                    alt={item.name}
                    className="w-full h-48 object-cover"
                  />
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-xl font-semibold text-gray-800 dark:text-white pr-2">{item.name}</h3>
                      <span className="text-xl font-bold gradient-text whitespace-nowrap">₹{item.price}</span>
                    </div>
                    <p className="text-gray-600 dark:text-gray-400 mb-4">{item.description}</p>
                    <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-500 mb-4">
                      <span className="flex items-center">
                        <Star className="w-4 h-4 text-yellow-500 mr-1" />
                        {item.rating || '4.0'}
                      </span>
                      <span>Serves: {item.serves}</span>
                      <span className="text-orange-500 font-medium">{item.canteen_name}</span>
                    </div>
                    <div className="flex items-center justify-between mb-4">
                      <span className={`text-sm font-medium ${
                        item.quantity_available <= 5 
                          ? 'text-yellow-600 dark:text-yellow-400' 
                          : 'text-green-600 dark:text-green-400'
                      }`}>
                        {item.quantity_available <= 5 ? 'Limited Stock' : 'Available'}
                      </span>
                      <span className="text-sm text-gray-600 dark:text-gray-400">
                        {item.quantity_available} left
                      </span>
                    </div>
                    <button
                      onClick={() => addToCart(item)}
                      disabled={addingToCart.has(item.id) || item.quantity_available <= 0}
                      className="w-full flex items-center justify-center space-x-2 modern-button text-white py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      <ShoppingCart className="w-5 h-5" />
                      <span>
                        {addingToCart.has(item.id) ? 'Adding...' : 
                         item.quantity_available <= 0 ? 'Out of Stock' : 'Add to Cart'}
                      </span>
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {filteredMenuItems.length === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 glass-morphism rounded-full flex items-center justify-center mx-auto mb-4">
                  <Utensils className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">No items found</h3>
                <p className="text-gray-600 dark:text-gray-400">Try adjusting your search or filter criteria</p>
              </div>
            )}
          </div>
        )}

        {/* Orders Tab */}
        {activeTab === 'orders' && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800 dark:text-white">My Orders</h2>

            {orders.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 glass-morphism rounded-full flex items-center justify-center mx-auto mb-4">
                  <Clock className="w-8 h-8 text-gray-500 dark:text-gray-400" />
                </div>
                <h3 className="text-lg font-medium text-gray-800 dark:text-white mb-2">No orders yet</h3>
                <p className="text-gray-600 dark:text-gray-400">Your orders will appear here once you place them</p>
              </div>
            ) : (
              <div className="space-y-6">
                {orders.map((order) => (
                  <div key={order.id} className="glass-morphism-strong rounded-xl p-6 w-full">
                    <div className="flex flex-col lg:flex-row justify-between items-start mb-4 gap-4">
                      <div>
                        <h4 className="text-lg font-semibold text-gray-800 dark:text-white">
                          Order #{order.id.slice(0, 8)}
                        </h4>
                        <p className="text-sm text-gray-600 dark:text-gray-500">
                          {new Date(order.created_at).toLocaleDateString()} at{' '}
                          {new Date(order.created_at).toLocaleTimeString()}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold gradient-text">₹{order.total_amount}</p>
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                          {getStatusIcon(order.status)}
                          <span className="ml-1 capitalize">{order.status}</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {order.order_items.map((item) => (
                        <div key={item.id} className="flex justify-between items-center glass-morphism p-3 rounded border border-white/10">
                          <span className="text-gray-600 dark:text-gray-300">
                            {item.menu_item.name} x {item.quantity}
                          </span>
                          <span className="font-medium text-gray-800 dark:text-white">₹{item.price * item.quantity}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Footer />

      {/* Cart Sidebar */}
      {isCartOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex justify-end z-50">
          <div className="w-full max-w-md bg-white dark:bg-gray-900 h-full overflow-y-auto">
            <div className="p-6 border-b border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-800 dark:text-white">Your Cart</h3>
                <button
                  onClick={() => setIsCartOpen(false)}
                  className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-gray-600 dark:text-gray-400" />
                </button>
              </div>
            </div>

            <div className="p-6">
              {cartItems.length === 0 ? (
                <div className="text-center py-8">
                  <ShoppingCart className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600 dark:text-gray-400">Your cart is empty</p>
                </div>
              ) : (
                <>
                  <div className="space-y-4 mb-6">
                    {cartItems.map((item) => (
                      <div key={item.id} className="flex items-center space-x-4 p-4 glass-morphism rounded-lg">
                        <img
                          src={item.menu_item.image_url}
                          alt={item.menu_item.name}
                          className="w-16 h-16 object-cover rounded-lg"
                        />
                        <div className="flex-1">
                          <h4 className="font-medium text-gray-800 dark:text-white">{item.menu_item.name}</h4>
                          <p className="text-sm text-gray-600 dark:text-gray-400">₹{item.menu_item.price}</p>
                        </div>
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => updateCartQuantity(item.id, item.quantity - 1)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <span className="w-8 text-center">{item.quantity}</span>
                          <button
                            onClick={() => updateCartQuantity(item.id, item.quantity + 1)}
                            className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div className="flex justify-between items-center mb-4">
                      <span className="text-lg font-semibold text-gray-800 dark:text-white">Total:</span>
                      <span className="text-xl font-bold gradient-text">₹{cartTotal}</span>
                    </div>
                    <button
                      onClick={placeOrder}
                      disabled={placingOrder || cartItems.length === 0}
                      className="w-full modern-button text-white py-3 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {placingOrder ? 'Placing Order...' : 'Place Order'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentDashboard;