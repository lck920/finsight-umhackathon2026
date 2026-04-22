import { useState, useEffect } from "react";
import { Menu, X, LineChart, Receipt, MessageSquareCode, FileText } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";

export const Navigation = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const menuItems = [
    { label: "Cashflow", href: "/expenses", icon: Receipt },
    { label: "Analytics", href: "/analytics", icon: LineChart },
    { label: "Report", href: "/report", icon: FileText },
    { label: "AI Assistant", href: "/chat", icon: MessageSquareCode }
  ];

  const isActive = (path: string) => location.pathname.startsWith(path);

  return (
    <nav className={`sticky-nav ${isScrolled ? 'shadow-lg' : ''} transition-all duration-300`}>
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <button 
            onClick={() => navigate('/')}
            className="flex items-center space-x-3 hover:opacity-80 transition-opacity duration-300"
          >
            <div className="w-8 h-8 bg-gradient-primary rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">F</span>
            </div>
            <span className="text-2xl font-bold text-primary">FinSight</span>
          </button>

          {/* Desktop Menu */}
          <div className="hidden md:flex items-center space-x-8">
            {menuItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  onClick={() => navigate(item.href)}
                  className={`flex items-center text-foreground hover:text-primary transition-colors duration-300 font-medium cursor-pointer ${isActive(item.href) ? 'text-primary' : ''}`}
                >
                  <Icon className="w-4 h-4 mr-2" />
                  {item.label}
                </button>
              );
            })}
          </div>

          <div className="hidden md:flex items-center space-x-4">
            <div className="w-8 h-8 bg-accent rounded-full flex items-center justify-center shadow-glow">
              <span className="text-sm font-bold text-white">US</span>
            </div>
          </div>

          {/* Mobile Menu Button */}
          <button
            className="md:hidden text-primary"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            {isMobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>

        {/* Mobile Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden mt-4 pb-4 border-t border-border">
            <div className="flex flex-col space-y-4 pt-4">
              {menuItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    onClick={() => {
                      setIsMobileMenuOpen(false);
                      navigate(item.href);
                    }}
                    className={`flex items-center text-left text-foreground hover:text-primary transition-colors duration-300 font-medium ${isActive(item.href) ? 'text-primary' : ''}`}
                  >
                    <Icon className="w-5 h-5 mr-3" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};