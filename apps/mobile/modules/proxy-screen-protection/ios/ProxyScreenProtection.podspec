Pod::Spec.new do |s|
  s.name             = 'ProxyScreenProtection'
  s.version          = '1.0.0'
  s.summary          = 'Proxy Lotus screenshot/screen-capture detection (RFC §4)'
  s.description      = 'Forwards iOS screenshot and screen-capture notifications to JS. Android side lives under ../android and is wired by the with-screen-protection config plugin.'
  s.author           = 'Proxy'
  s.homepage         = 'https://docs.expo.dev/modules/'
  s.platforms        = { :ios => '16.4' }
  s.source           = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
