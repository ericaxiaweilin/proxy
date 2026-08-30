Pod::Spec.new do |s|
  s.name             = 'ProxyNativeTabBar'
  s.version          = '1.0.0'
  s.summary          = 'Proxy native root tab bar'
  s.description      = 'Embeds UITabBar so iOS renders the system Liquid Glass selection lens.'
  s.author           = 'Proxy'
  s.homepage         = 'https://docs.expo.dev/modules/'
  s.platforms        = { :ios => '16.4' }
  s.source           = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
